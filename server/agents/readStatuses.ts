import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, realpath, stat, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Agent } from "../../src/shared/api/contracts.js";
import type { HerdrService } from "../herdr/herdrService.js";
import { createReadReceiptDiagnostics } from "../../src/shared/api/readReceiptDiagnostics.js";

const logReadReceipt = createReadReceiptDiagnostics();

export interface ReadReceiptOptions {
  directory: string;
  herdrSocket: string;
}

export class ReadStatusError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function missing(error: unknown) {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

/** Fernblick-owned receipts. This module only reads Herdr; it never focuses or reports state. */
export class AgentReadStatuses {
  private readonly directory: string;
  private readonly namespace: string;

  constructor(
    private readonly service: HerdrService,
    private readonly options: ReadReceiptOptions,
  ) {
    this.directory = resolve(options.directory);
    // Stable across Herdr restarts at this configured endpoint. A separate
    // socket's receipts must never be garbage-collected from our snapshot.
    this.namespace = createHash("sha256").update(resolve(options.herdrSocket)).digest("hex");
  }

  private async storage<T>(
    operation: "save" | "load" | "cleanup",
    requestId: string,
    action: () => Promise<T>,
  ): Promise<T> {
    const started = performance.now();
    try {
      const result = await action();
      if (operation === "save")
        logReadReceipt({
          boundary: "persistence",
          operation,
          requestId,
          category: "success",
          durationMs: performance.now() - started,
        });
      return result;
    } catch (error) {
      logReadReceipt({
        boundary: "persistence",
        operation,
        requestId,
        category: "storage",
        durationMs: performance.now() - started,
      });
      throw error;
    }
  }

  private async scope() {
    try {
      const path = await realpath(this.options.herdrSocket);
      const info = await stat(path, { bigint: true });
      if (!info.isSocket()) throw new Error("Not a socket");
      // The socket generation survives Fernblick restarts, but not a cold Herdr
      // restart (where pane IDs and state sequences may be reused).
      return [path, info.dev, info.ino, info.birthtimeNs, info.ctimeNs].map(String);
    } catch {
      throw new ReadStatusError(503, "Cannot identify the Herdr session. Try again shortly.");
    }
  }

  private completionId(agent: Agent, scope: string[]) {
    return createHash("sha256")
      .update(
        JSON.stringify([
          "fernblick-read-v1",
          scope,
          agent.pane_id,
          agent.terminal_id,
          agent.agent,
          agent.agent_session,
          // Unrelated pane revisions must not turn the same answer unread again.
          agent.state_change_seq ?? agent.revision,
        ]),
      )
      .digest("hex");
  }

  private async snapshot() {
    const scope = await this.scope();
    const dashboard = await this.service.getDashboard();
    if (JSON.stringify(scope) !== JSON.stringify(await this.scope()))
      throw new ReadStatusError(503, "Herdr restarted. Refresh and try again.");
    return { dashboard, scope };
  }

  private async prepare() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const info = await lstat(this.directory);
    if (
      !info.isDirectory() ||
      info.isSymbolicLink() ||
      info.uid !== process.getuid?.() ||
      (info.mode & 0o777) !== 0o700 ||
      (await realpath(this.directory)) !== this.directory
    )
      throw new Error("Read receipt directory must be private (0700), owned, and not symlinked");
  }

  private async receipt(id: string, create = false) {
    // IDs come from completionId, never from filenames supplied by a browser.
    const path = join(this.directory, `${this.namespace}.${id}.read`);
    let file;
    try {
      file = await open(
        path,
        constants.O_NOFOLLOW |
          constants.O_NONBLOCK |
          (create ? constants.O_WRONLY | constants.O_CREAT : constants.O_RDONLY),
        0o600,
      );
    } catch (error) {
      if (!create && missing(error)) return false;
      throw error;
    }
    try {
      const info = await file.stat();
      if (
        !info.isFile() ||
        info.uid !== process.getuid?.() ||
        (info.mode & 0o077) !== 0 ||
        info.nlink !== 1 ||
        info.size !== 0
      )
        throw new Error("Unsafe read receipt file");
      // An immutable, empty marker has no partial JSON/write state and concurrent
      // acknowledgements cannot overwrite each other, even from two backends.
      if (create) await file.sync();
    } finally {
      await file.close();
    }
    if (create) {
      const directory = await open(
        this.directory,
        constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
      );
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
    }
    return true;
  }

  private async cleanup(candidates: string[], current: Set<string>) {
    for (const name of candidates) {
      const id = name.slice(this.namespace.length + 1, -".read".length);
      if (current.has(id)) continue;
      const path = join(this.directory, name);
      try {
        // Only remove our empty, private marker files. Never follow links or
        // recursively delete directories/unrecognized content in this store.
        const info = await lstat(path);
        if (
          info.isFile() &&
          info.uid === process.getuid?.() &&
          (info.mode & 0o077) === 0 &&
          info.nlink === 1 &&
          info.size === 0
        )
          await unlink(path);
      } catch (error) {
        if (!missing(error)) throw error;
      }
    }
  }

  async getDashboard() {
    const requestId = randomUUID();
    const candidates = await this.storage("load", requestId, async () => {
      await this.prepare();
      // Enumerate BEFORE requesting the authoritative snapshot. A slow refresh
      // must not delete receipts written for a newer answer while it was waiting,
      // including writes from another backend sharing this directory.
      const pattern = new RegExp(`^${this.namespace}\\.[a-f0-9]{64}\\.read$`);
      return (await readdir(this.directory)).filter((name) => pattern.test(name));
    });
    const { dashboard, scope } = await this.snapshot();
    const current = new Set(dashboard.agents.map((agent) => this.completionId(agent, scope)));
    await this.storage("cleanup", requestId, () => this.cleanup(candidates, current)).catch(() => {
      // Cleanup is retryable maintenance; a failure must not hide current agents.
    });
    return {
      ...dashboard,
      agents: await Promise.all(
        dashboard.agents.map(async (agent) => {
          if (agent.agent_status !== "done") return agent;
          const id = this.completionId(agent, scope);
          return {
            ...agent,
            completion: { id, read: await this.storage("load", requestId, () => this.receipt(id)) },
          };
        }),
      ),
    };
  }

  async markRead(paneId: string, completionId: string, requestId: string = randomUUID()) {
    const { dashboard, scope } = await this.snapshot();
    const agent = dashboard.agents.find((item) => item.pane_id === paneId);
    if (!agent) throw new ReadStatusError(404, "Agent no longer exists.");
    const id = this.completionId(agent, scope);
    if (agent.agent_status !== "done" || completionId !== id)
      throw new ReadStatusError(409, "The answer changed. Refresh before marking it read.");
    await this.storage("save", requestId, async () => {
      await this.prepare();
      await this.receipt(id, true);
    });
  }
}
