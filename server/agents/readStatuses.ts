import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Agent } from "../../src/shared/api/contracts.js";
import type { HerdrService } from "../herdr/herdrService.js";

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

  constructor(
    private readonly service: HerdrService,
    private readonly options: ReadReceiptOptions,
  ) {
    this.directory = resolve(options.directory);
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
    const path = join(this.directory, `${id}.read`);
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

  async getDashboard() {
    const { dashboard, scope } = await this.snapshot();
    await this.prepare();
    return {
      ...dashboard,
      agents: await Promise.all(
        dashboard.agents.map(async (agent) => {
          if (agent.agent_status !== "done") return agent;
          const id = this.completionId(agent, scope);
          return { ...agent, completion: { id, read: await this.receipt(id) } };
        }),
      ),
    };
  }

  async markRead(paneId: string, completionId: string) {
    const { dashboard, scope } = await this.snapshot();
    const agent = dashboard.agents.find((item) => item.pane_id === paneId);
    if (!agent) throw new ReadStatusError(404, "Agent no longer exists.");
    const id = this.completionId(agent, scope);
    if (agent.agent_status !== "done" || completionId !== id)
      throw new ReadStatusError(409, "The answer changed. Refresh before marking it read.");
    await this.prepare();
    await this.receipt(id, true);
  }
}
