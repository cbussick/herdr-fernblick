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
import { deleteChatResponseSchema } from "../../src/shared/api/contracts.js";
import type { SavedChat } from "../../src/shared/api/contracts.js";
import { uploadIdSchema } from "../../packages/pi-live-chat/protocol.js";

const receiptSchema = deleteChatResponseSchema.omit({ ok: true });
const uploadReferenceSchema = z.object({ id: uploadIdSchema });
const textBlockSchema = z.object({ type: z.literal("text"), text: z.string() });
function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
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
  uploadIds: Array<string>;
  boardIds: Array<string>;
  fileIdentity: string;
};

export type CatalogCache = Map<string, { stamp: string; chat: CatalogChat }>;

// Pi remains responsible for restoring conversation context. Asset scans are reserved for mutations.
export class SessionCatalog {
  private readonly cache: CatalogCache = new Map();

  constructor(
    readonly root = resolve(
      process.env.FERNBLICK_PI_SESSION_DIR ??
        process.env.PI_CODING_AGENT_SESSION_DIR ??
        join(process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent"), "sessions"),
    ),
  ) {}

  // Dashboard polling only needs the bounded header, not the growing transcript.
  // As with readActive, the path comes from Herdr rather than the browser.
  async readActiveId(path: string): Promise<string | null> {
    const file = await open(
      resolve(path),
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    ).catch(() => null);
    if (!file) {
      return null;
    }
    try {
      if (!(await file.stat()).isFile()) {
        return null;
      }
      const buffer = Buffer.alloc(16 * 1024);
      const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
      const header = headerSchema.safeParse(
        JSON.parse(buffer.subarray(0, bytesRead).toString("utf8").split("\n", 1)[0]),
      );
      return header.success && /^[A-Za-z0-9_-]{1,200}$/.test(header.data.id)
        ? header.data.id
        : null;
    } catch {
      // Missing, changing or unreadable sessions must not hide the dashboard.
      return null;
    } finally {
      await file.close();
    }
  }

  // The path comes only from Herdr, never from a browser URL.
  readActive(path: string): Promise<CatalogChat | null> {
    return this.read(resolve(path));
  }

  list(strict = false): Promise<Array<CatalogChat>> {
    return this.scan(strict);
  }

  // A separate cache prevents lightweight list metadata from satisfying deletion's safety scans.
  async scanMetadata(cache: CatalogCache): Promise<void> {
    await this.scan(false, cache);
  }

  private async scan(strict: boolean, metadataCache?: CatalogCache): Promise<Array<CatalogChat>> {
    const cache = metadataCache ?? this.cache;
    const files: Array<string> = [];
    try {
      // Pi's default layout has one project-directory level; custom roots may be flat.
      for (const entry of await readdir(this.root, { withFileTypes: true })) {
        if (entry.isFile() && entry.name.endsWith(".jsonl")) {
          files.push(join(this.root, entry.name));
        } else if (entry.isDirectory()) {
          const children = await readdir(join(this.root, entry.name), {
            withFileTypes: true,
          }).catch((error: unknown) => {
            if (isMissing(error)) {
              return [];
            }
            throw error;
          });
          for (const child of children) {
            if (child.isFile() && child.name.endsWith(".jsonl")) {
              files.push(join(this.root, entry.name, child.name));
            }
          }
        }
      }
    } catch (error) {
      if (isMissing(error)) {
        cache.clear();
        return [];
      }
      throw new SavedChatError(
        503,
        "Cannot read saved sessions. Check the session directory permissions.",
      );
    }
    const present = new Set(files);
    for (const path of cache.keys()) {
      if (!present.has(path)) {
        cache.delete(path);
      }
    }
    const chats: Array<CatalogChat> = [];
    // Sequential reads bound file descriptors and memory; unchanged files use cached metadata.
    for (const path of files) {
      const chat = await this.read(path, metadataCache);
      if (chat) {
        chats.push(chat);
      } else if (strict && !(await this.isEmpty(path))) {
        throw new SavedChatError(
          503,
          "Cannot verify shared files because a saved session is unreadable or invalid.",
        );
      }
    }
    return chats.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
  }

  private async isEmpty(path: string): Promise<boolean> {
    // An uninitialized session cannot reference shared assets. Distinguish that
    // from a nonempty/corrupt or unreadable file; those still fail closed.
    const file = await open(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    ).catch(() => null);
    if (!file) {
      return false;
    }
    try {
      const stats = await file.stat();
      return stats.isFile() && stats.size === 0;
    } catch {
      return false;
    } finally {
      await file.close();
    }
  }

  async get(id: string) {
    const chat = (await this.list()).find((candidate) => candidate.id === id);
    if (!chat) {
      throw new SavedChatError(404, "This saved session is no longer available. Refresh the list.");
    }
    return chat;
  }

  async deletionReceipt(id: string) {
    if (!/^[a-f0-9]{64}$/.test(id)) {
      return null;
    }
    const file = await open(
      join(this.root, `.fernblick-deleted-${id}.json`),
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    ).catch((error: unknown) => {
      if (isMissing(error)) {
        return null;
      }
      throw new SavedChatError(503, "Cannot read the session deletion receipt.");
    });
    if (!file) {
      return null;
    }
    try {
      const stats = await file.stat();
      if (
        !stats.isFile() ||
        stats.uid !== process.getuid?.() ||
        (stats.mode & 0o077) !== 0 ||
        stats.nlink !== 1 ||
        stats.size > 256 * 1024
      ) {
        throw new SavedChatError(503, "Unsafe session deletion receipt.");
      }
      const bytes = Buffer.alloc(stats.size + 1);
      let size = 0;
      while (size < bytes.length) {
        const result = await file.read(bytes, size, bytes.length - size, size);
        if (!result.bytesRead) {
          break;
        }
        size += result.bytesRead;
      }
      if (size !== stats.size) {
        throw new SavedChatError(503, "Session deletion receipt changed.");
      }
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
      ) {
        throw new SavedChatError(409, "This session changed during deletion. Refresh the list.");
      }
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
      if (error instanceof SavedChatError) {
        throw error;
      }
      if (isMissing(error)) {
        throw new SavedChatError(
          404,
          "This saved session is no longer available. Refresh the list.",
        );
      }
      throw new SavedChatError(
        503,
        "Session cleanup failed. Some related files may already be removed. Try again.",
      );
    } finally {
      this.cache.delete(stagedPath);
      if (!moved) {
        await rmdir(staging).catch(() => {});
      }
    }
  }

  private async read(path: string, metadataCache?: CatalogCache): Promise<CatalogChat | null> {
    const cache = metadataCache ?? this.cache;
    const metadataOnly = metadataCache !== undefined;
    const file = await open(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    ).catch(() => null);
    if (!file) {
      cache.delete(path);
      return null;
    }
    try {
      const stats = await file.stat();
      if (!stats.isFile()) {
        cache.delete(path);
        return null;
      }
      const stamp = `${stats.dev}:${stats.ino}:${stats.size}:${stats.mtimeMs}:${stats.ctimeMs}`;
      const cached = cache.get(path);
      if (cached?.stamp === stamp) {
        return cached.chat;
      }
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
        // Parse only potential names after finding the first prompt. JSON validation below
        // distinguishes real records from quoted text, regardless of property order.
        if (
          metadataOnly &&
          !first &&
          !value.includes('"session_info"') &&
          (preview || !value.includes('"user"'))
        ) {
          return;
        }
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
          !metadataOnly &&
          entry?.type === "custom" &&
          entry.customType === "fernblick-image-uploads" &&
          Array.isArray(entry.data)
        ) {
          for (const ref of entry.data) {
            const parsed = uploadReferenceSchema.safeParse(ref);
            if (parsed.success) {
              uploadIds.add(parsed.data.id);
            }
          }
        }
        if (entry?.type === "session_info" && entry.name !== undefined) {
          title = entry.name.slice(0, 160);
        }
        if (!preview && entry?.type === "message" && entry.message?.role === "user") {
          const content = entry.message.content;
          preview = (
            typeof content === "string"
              ? content
              : Array.isArray(content)
                ? content
                    .flatMap((block: unknown) => {
                      const parsed = textBlockSchema.safeParse(block);
                      return parsed.success ? [parsed.data.text] : [];
                    })
                    .join(" ")
                : ""
          )
            .replaceAll(/\s+/g, " ")
            .trim()
            .slice(0, 240);
        }
      };
      for await (const chunk of file.createReadStream({ encoding: "utf8", autoClose: false })) {
        // References in oversized image/message lines must still protect shared assets.
        if (!metadataOnly) {
          const references = referenceTail + String(chunk);
          for (const match of references.matchAll(/\/api\/boards\/([a-f0-9]{64})\/snapshots\//g)) {
            boardIds.add(match[1]);
          }
          for (const match of references.matchAll(
            /\/api\/uploads\/([0-9a-f-]{36}\.(?:png|jpg|gif|webp))/g,
          )) {
            const parsed = uploadIdSchema.safeParse(match[1]);
            if (parsed.success) {
              uploadIds.add(parsed.data);
            }
          }
          referenceTail = references.slice(-128);
        }
        for (const [index, part] of String(chunk).split("\n").entries()) {
          if (index > 0) {
            if (!oversized) {
              consume(line);
            }
            first = false;
            line = "";
            oversized = false;
            if (!header) {
              cache.delete(path);
              return null;
            }
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
      if (line && !oversized) {
        consume(line);
      }
      if (!header) {
        cache.delete(path);
        return null;
      }
      const after = await file.stat();
      if (`${after.dev}:${after.ino}:${after.size}:${after.mtimeMs}:${after.ctimeMs}` !== stamp) {
        // Do not persist a partial scan of a session that changed while it was being read.
        cache.delete(path);
        return null;
      }
      const chat: CatalogChat = {
        id: createHash("sha256")
          .update(JSON.stringify([path, header.id]))
          .digest("hex"),
        path,
        sessionId: header.id,
        uploadIds: [...uploadIds],
        boardIds: [...boardIds],
        fileIdentity: `${stats.dev}:${stats.ino}`,
        title: title.replaceAll(/\s+/g, " ").trim() || preview || "Untitled session",
        preview,
        cwd: header.cwd,
        updatedAt: stats.mtime.toISOString(),
      };
      cache.set(path, { stamp, chat });
      return chat;
    } catch {
      // A damaged or concurrently removed session must not hide the other saved chats.
      cache.delete(path);
      return null;
    } finally {
      await file.close();
    }
  }
}
