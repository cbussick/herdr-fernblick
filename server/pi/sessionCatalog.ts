import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  link,
  lstat,
  mkdtemp,
  open,
  readdir,
  rename,
  rmdir,
  unlink,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { z } from "zod";
import { deleteChatResponseSchema, type SavedChat } from "../../src/shared/api/contracts.js";
import { uploadIdSchema } from "../../packages/pi-live-chat/protocol.js";

const receiptSchema = deleteChatResponseSchema.omit({ ok: true });
const headerSchema = z.object({
  type: z.literal("session"),
  id: z.string().min(1),
  cwd: z.string().refine(isAbsolute),
});
const entrySchema = z.object({
  type: z.string(),
  name: z.string().optional(),
  customType: z.string().optional(),
  data: z.unknown().optional(),
  message: z.object({ role: z.string(), content: z.unknown() }).optional(),
});

export class SavedChatError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export type CatalogChat = Omit<SavedChat, "activePaneId"> & {
  path: string;
  sessionId: string;
  uploadIds: string[];
  boardIds: string[];
  fileIdentity: string;
};

// Only metadata is read here. Pi remains responsible for restoring conversation context.
export class SessionCatalog {
  private readonly cache = new Map<string, { stamp: string; chat: CatalogChat }>();

  constructor(
    private readonly root = resolve(
      process.env.FERNBLICK_PI_SESSION_DIR ??
        process.env.PI_CODING_AGENT_SESSION_DIR ??
        join(process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent"), "sessions"),
    ),
  ) {}

  async list(strict = false): Promise<CatalogChat[]> {
    const files: string[] = [];
    try {
      // Pi's default layout has one project-directory level; custom roots may be flat.
      for (const entry of await readdir(this.root, { withFileTypes: true })) {
        if (entry.isFile() && entry.name.endsWith(".jsonl"))
          files.push(join(this.root, entry.name));
        else if (entry.isDirectory()) {
          const children = await readdir(join(this.root, entry.name), {
            withFileTypes: true,
          }).catch((error: NodeJS.ErrnoException) => {
            if (error.code === "ENOENT") return [];
            throw error;
          });
          for (const child of children) {
            if (child.isFile() && child.name.endsWith(".jsonl"))
              files.push(join(this.root, entry.name, child.name));
          }
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw new SavedChatError(
        503,
        "Cannot read saved chats. Check the session directory permissions.",
      );
    }
    const present = new Set(files);
    for (const path of this.cache.keys()) if (!present.has(path)) this.cache.delete(path);
    const chats: CatalogChat[] = [];
    // Sequential reads bound file descriptors and memory; unchanged files use cached metadata.
    for (const path of files) {
      const chat = await this.read(path);
      if (chat) chats.push(chat);
      else if (strict)
        throw new SavedChatError(
          503,
          "Cannot verify shared files because a saved session is unreadable or invalid.",
        );
    }
    return chats.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
  }

  async get(id: string) {
    const chat = (await this.list()).find((candidate) => candidate.id === id);
    if (!chat)
      throw new SavedChatError(404, "This saved chat is no longer available. Refresh the list.");
    return chat;
  }

  async deletionReceipt(id: string) {
    if (!/^[a-f0-9]{64}$/.test(id)) return null;
    const file = await open(
      join(this.root, `.fernblick-deleted-${id}.json`),
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    ).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw new SavedChatError(503, "Cannot read the chat deletion receipt.");
    });
    if (!file) return null;
    try {
      const stats = await file.stat();
      if (
        !stats.isFile() ||
        stats.uid !== process.getuid?.() ||
        (stats.mode & 0o077) !== 0 ||
        stats.nlink !== 1 ||
        stats.size > 256 * 1024
      )
        throw new SavedChatError(503, "Unsafe chat deletion receipt.");
      const bytes = Buffer.alloc(stats.size + 1);
      let size = 0;
      while (size < bytes.length) {
        const result = await file.read(bytes, size, bytes.length - size, size);
        if (!result.bytesRead) break;
        size += result.bytesRead;
      }
      if (size !== stats.size) throw new SavedChatError(503, "Chat deletion receipt changed.");
      return receiptSchema.parse(JSON.parse(bytes.subarray(0, size).toString("utf8")));
    } finally {
      await file.close();
    }
  }

  async delete<T>(id: string, cleanup?: (chat: CatalogChat) => Promise<T>): Promise<T | undefined> {
    const chat = await this.get(id);
    // Rename into a private directory, then verify what actually moved before
    // destroying anything. A concurrent replacement is restored, never unlinked.
    const staging = await mkdtemp(join(dirname(chat.path), ".fernblick-delete-"));
    const stagedPath = join(staging, "session");
    let moved = false;
    try {
      await rename(chat.path, stagedPath);
      moved = true;
      const stats = await lstat(stagedPath);
      const staged = await this.read(stagedPath);
      if (
        !stats.isFile() ||
        `${stats.dev}:${stats.ino}` !== chat.fileIdentity ||
        staged?.sessionId !== chat.sessionId
      )
        throw new SavedChatError(409, "This chat changed during deletion. Refresh the list.");
      const result = await cleanup?.(staged);
      const receipt = receiptSchema.safeParse(result);
      if (receipt.success) {
        // IDs only, no transcript/drawing content. Persist before unlink so a
        // lost HTTP reply or backend restart can return the same cleanup result.
        const path = join(staging, "receipt");
        await writeFile(path, JSON.stringify(receipt.data), { mode: 0o600, flag: "wx" });
        await rename(path, join(this.root, `.fernblick-deleted-${id}.json`));
      }
      await unlink(stagedPath);
      moved = false;
      this.cache.delete(chat.path);
      return result;
    } catch (error) {
      if (moved) {
        // link is no-clobber: never overwrite a new session at the original path.
        try {
          await link(stagedPath, chat.path);
          await unlink(stagedPath);
          moved = false;
        } catch {
          throw new SavedChatError(
            503,
            "Deletion stopped. A session was preserved in a .fernblick-delete- recovery directory.",
          );
        }
      }
      if (error instanceof SavedChatError) throw error;
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        throw new SavedChatError(404, "This saved chat is no longer available. Refresh the list.");
      throw new SavedChatError(
        503,
        "Chat cleanup failed. Some related files may already be removed. Try again.",
      );
    } finally {
      this.cache.delete(stagedPath);
      if (!moved) await rmdir(staging).catch(() => {});
    }
  }

  private async read(path: string): Promise<CatalogChat | null> {
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW).catch(() => null);
    if (!file) return null;
    try {
      const stats = await file.stat();
      if (!stats.isFile()) return null;
      const stamp = `${stats.ino}:${stats.size}:${stats.mtimeMs}:${stats.ctimeMs}`;
      const cached = this.cache.get(path);
      if (cached?.stamp === stamp) return cached.chat;
      let header: z.infer<typeof headerSchema> | undefined;
      let first = true;
      let title = "";
      let preview = "";
      const uploadIds = new Set<string>();
      const boardIds = new Set<string>();
      let referenceTail = "";
      // Bound each line, including embedded images/tool output, rather than loading a transcript.
      let line = "";
      let oversized = false;
      const consume = (value: string) => {
        let raw: unknown;
        try {
          raw = JSON.parse(value);
        } catch {
          return;
        }
        if (first) {
          header = headerSchema.safeParse(raw).data;
          return;
        }
        const entry = entrySchema.safeParse(raw).data;
        if (
          entry?.type === "custom" &&
          entry.customType === "fernblick-image-uploads" &&
          Array.isArray(entry.data)
        ) {
          for (const ref of entry.data) {
            const parsed = uploadIdSchema.safeParse(ref?.id);
            if (parsed.success) uploadIds.add(parsed.data);
          }
        }
        if (entry?.type === "session_info" && entry.name !== undefined)
          title = entry.name.slice(0, 160);
        if (!preview && entry?.type === "message" && entry.message?.role === "user") {
          const content = entry.message.content;
          preview = (
            typeof content === "string"
              ? content
              : Array.isArray(content)
                ? content
                    .filter((block) => block?.type === "text" && typeof block.text === "string")
                    .map((block) => block.text)
                    .join(" ")
                : ""
          )
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 240);
        }
      };
      for await (const chunk of file.createReadStream({ encoding: "utf8", autoClose: false })) {
        // References in oversized image/message lines must still protect shared assets.
        const references = referenceTail + String(chunk);
        for (const match of references.matchAll(/\/api\/boards\/([a-f0-9]{64})\/snapshots\//g))
          boardIds.add(match[1]);
        for (const match of references.matchAll(
          /\/api\/uploads\/([0-9a-f-]{36}\.(?:png|jpg|gif|webp))/g,
        )) {
          const parsed = uploadIdSchema.safeParse(match[1]);
          if (parsed.success) uploadIds.add(parsed.data);
        }
        referenceTail = references.slice(-128);
        for (const [index, part] of String(chunk).split("\n").entries()) {
          if (index > 0) {
            if (!oversized) consume(line);
            first = false;
            line = "";
            oversized = false;
            if (!header) return null;
          }
          if (!oversized) {
            line += part;
            if (line.length > 1024 * 1024) {
              line = "";
              oversized = true;
            }
          }
        }
      }
      if (line && !oversized) consume(line);
      if (!header) return null;
      const chat: CatalogChat = {
        id: createHash("sha256")
          .update(JSON.stringify([path, header.id]))
          .digest("hex"),
        path,
        sessionId: header.id,
        uploadIds: [...uploadIds],
        boardIds: [...boardIds],
        fileIdentity: `${stats.dev}:${stats.ino}`,
        title: title.replace(/\s+/g, " ").trim() || preview || "Untitled chat",
        preview,
        cwd: header.cwd,
        updatedAt: stats.mtime.toISOString(),
      };
      this.cache.set(path, { stamp, chat });
      return chat;
    } catch {
      // A damaged or concurrently removed session must not hide the other saved chats.
      this.cache.delete(path);
      return null;
    } finally {
      await file.close();
    }
  }
}
