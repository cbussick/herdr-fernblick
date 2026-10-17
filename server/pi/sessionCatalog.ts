import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open, readdir, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { z } from "zod";
import type { SavedChat } from "../../src/shared/api/contracts.js";

const headerSchema = z.object({
  type: z.literal("session"),
  id: z.string().min(1),
  cwd: z.string().refine(isAbsolute),
});
const entrySchema = z.object({
  type: z.string(),
  name: z.string().optional(),
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

export type CatalogChat = Omit<SavedChat, "activePaneId"> & { path: string };

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

  async list(): Promise<CatalogChat[]> {
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
    }
    return chats.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
  }

  async get(id: string) {
    const chat = (await this.list()).find((candidate) => candidate.id === id);
    if (!chat)
      throw new SavedChatError(404, "This saved chat is no longer available. Refresh the list.");
    return chat;
  }

  async delete(id: string) {
    // Resolve the opaque ID again: never accept a client-supplied filesystem path.
    const chat = await this.get(id);
    try {
      await unlink(chat.path);
      this.cache.delete(chat.path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        throw new SavedChatError(404, "This saved chat is no longer available. Refresh the list.");
      throw new SavedChatError(
        503,
        "Cannot delete this saved chat. Check the session directory permissions.",
      );
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
