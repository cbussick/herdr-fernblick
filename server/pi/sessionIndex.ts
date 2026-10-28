import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, rename, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { z } from "zod";
import { savedChatSchema } from "../../src/shared/api/contracts.js";
import { SessionCatalog, type CatalogCache } from "./sessionCatalog.js";

const metadataSchema = savedChatSchema.omit({ activePaneId: true }).extend({
  path: z.string(),
  sessionId: z.string(),
  fileIdentity: z.string(),
});
const indexSchema = z.object({
  version: z.literal(1),
  root: z.string(),
  entries: z.array(z.object({ stamp: z.string(), chat: metadataSchema })),
});

// This index is a disposable browsing aid. Resume/delete always resolve the real session
// through SessionCatalog; cached paths and asset references never authorize mutations.
export class SessionIndex {
  readonly path: string;
  private readonly cache: CatalogCache = new Map();
  private readonly removed = new Set<string>();
  private pending?: Promise<void>;
  private timer?: ReturnType<typeof setInterval>;
  private indexError?: string;
  private closed = false;
  private storageSafe = false;

  constructor(
    private readonly catalog: SessionCatalog,
    private readonly directory = join(homedir(), ".cache/fernblick/session-index"),
  ) {
    this.path = join(directory, createHash("sha256").update(catalog.root).digest("hex") + ".json");
  }

  async start() {
    try {
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      const info = await lstat(this.directory);
      if (
        !info.isDirectory() ||
        info.uid !== process.getuid?.() ||
        (info.mode & 0o777) !== 0o700 ||
        (await realpath(this.directory)) !== resolve(this.directory)
      )
        throw new Error("Unsafe metadata index directory");
      this.storageSafe = true;
      await this.load();
    } catch {
      // Corrupt/unavailable caches are rebuilt; browsing must not depend on cache storage.
    }
    void this.refresh();
    this.timer = setInterval(() => {
      void this.refresh();
    }, 30_000);
    this.timer.unref();
  }

  snapshot() {
    return {
      chats: [...this.cache.values()]
        .map(({ chat }) => chat)
        .filter((chat) => !this.removed.has(chat.id))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id)),
      indexing: this.pending !== undefined,
      ...(this.indexError ? { indexError: this.indexError } : {}),
    };
  }

  forget(id: string) {
    this.removed.add(id);
    for (const [path, { chat }] of this.cache) if (chat.id === id) this.cache.delete(path);
    void this.refresh();
  }

  refresh(): Promise<void> {
    if (this.closed) return Promise.resolve();
    if (this.pending) return this.pending;
    this.pending = this.scan().finally(() => {
      this.pending = undefined;
    });
    return this.pending;
  }

  async close() {
    this.closed = true;
    clearInterval(this.timer);
    await this.pending;
  }

  private async scan() {
    try {
      await this.catalog.scanMetadata(this.cache);
      for (const [path, { chat }] of this.cache)
        if (this.removed.has(chat.id)) this.cache.delete(path);
      this.indexError = undefined;
    } catch {
      this.indexError = "Could not refresh saved sessions. Retrying in the background.";
      return;
    }
    if (this.storageSafe)
      await this.persist().catch(() => {
        // An unwritable/full cache must not hide successfully indexed cards.
      });
  }

  private async load() {
    const file = await open(
      this.path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      const stats = await file.stat();
      if (
        !stats.isFile() ||
        stats.uid !== process.getuid?.() ||
        (stats.mode & 0o777) !== 0o600 ||
        stats.nlink !== 1 ||
        stats.size > 32 * 1024 * 1024
      )
        return;
      const data = indexSchema.parse(JSON.parse(await file.readFile("utf8")));
      if (data.root !== this.catalog.root) return;
      for (const entry of data.entries) {
        this.cache.set(entry.chat.path, {
          stamp: entry.stamp,
          chat: { ...entry.chat, uploadIds: [], boardIds: [] },
        });
      }
    } finally {
      await file.close();
    }
  }

  private async persist() {
    const temporary = join(this.directory, `.${randomUUID()}.tmp`);
    try {
      await writeFile(
        temporary,
        JSON.stringify({
          version: 1,
          root: this.catalog.root,
          entries: [...this.cache.values()].map(({ stamp, chat }) => ({
            stamp,
            chat: metadataSchema.parse(chat),
          })),
        }),
        { mode: 0o600, flag: "wx" },
      );
      await rename(temporary, this.path);
    } finally {
      await unlink(temporary).catch(() => {});
    }
  }
}
