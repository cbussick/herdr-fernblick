import { randomUUID } from "node:crypto";
import { chmod, lstat, unlink } from "node:fs/promises";
import { connect, createServer, type Socket } from "node:net";
import { resolve } from "node:path";
import type { Agent } from "../../src/shared/api/contracts.js";
import {
  responseSchema,
  commandSchema,
  COMPACT_TIMEOUT_MS,
  matchesTarget,
  targetOf,
  sameDefaultSelection,
  type DefaultSelection,
  snapshotSchema,
  type BridgeResponse,
  type Command,
  type Snapshot,
  type Target,
  type ThinkingLevel,
} from "../../packages/pi-live-chat/protocol.js";
import {
  privateDirectory,
  processIdentity,
  validateSocket,
} from "../../packages/pi-live-chat/security.js";
import { receiveFrames, writeFrame } from "../../packages/pi-live-chat/transport.js";
import {
  boardRequestSchema,
  boardControlSchema,
  type BoardControl,
  type BoardScene,
  type BoardGrant,
  type BoardRequest,
} from "../../packages/pi-live-chat/boardProtocol.js";
import { BoardStore } from "../boards/storage.js";
import type { TreePageRequest } from "../../packages/pi-live-chat/treeProtocol.js";

export function boardSessionKey(snapshot: Snapshot) {
  return JSON.stringify([resolve(snapshot.identity.herdrSocket), snapshot.identity.sessionId]);
}

export class LiveChatError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly starting = false,
  ) {
    super(message);
  }
}
interface Peer {
  socket: Socket;
  snapshot?: Snapshot;
  boardGrant?: BoardGrant;
  boardRequests: number;
  boardRun?: { id: string; revoked: boolean; expiresAt: number };
}
interface Pending {
  peer: Peer;
  resolve: (response: BridgeResponse) => void;
  command: Command;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

async function removeStaleSocket(path: string) {
  let before;
  try {
    before = await validateSocket(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  const refused = await new Promise<boolean>((done, reject) => {
    const probe = connect(path);
    probe.setTimeout(500);
    probe.once("connect", () => {
      probe.destroy();
      done(false);
    });
    probe.once("timeout", () => {
      probe.destroy();
      reject(new Error("Existing Pi socket did not respond"));
    });
    probe.once("error", (error: NodeJS.ErrnoException) => {
      probe.destroy();
      if (error.code === "ECONNREFUSED") done(true);
      else reject(error);
    });
  });
  if (!refused) throw new Error("Pi socket already in use");
  const after = await lstat(path);
  if (after.ino !== before.ino || after.dev !== before.dev)
    throw new Error("Pi socket changed during stale check");
  await unlink(path);
}

export class LiveBridge {
  private peers = new Set<Peer>();
  private listeners = new Map<() => void, string | undefined>();
  private pending = new Map<string, Pending>();
  private server = createServer((socket) => this.accept(socket));
  private boards?: BoardStore;
  setBoardStore(boards: BoardStore) {
    this.boards = boards;
  }
  private boardAgent?: (pane: string) => Promise<Agent>;
  setBoardAgentResolver(resolveAgent: (pane: string) => Promise<Agent>) {
    this.boardAgent = resolveAgent;
  }
  private boardRenderer?: (scene: BoardScene) => Promise<Buffer>;
  setBoardRenderer(render: (scene: BoardScene) => Promise<Buffer>) {
    this.boardRenderer = render;
  }
  private clearBoardAccess(peer: Peer) {
    if (peer.boardRun && !peer.boardRun.revoked) {
      peer.boardRun.revoked = true;
      if (!peer.socket.destroyed)
        writeFrame(peer.socket, { type: "board-run-revoke", runId: peer.boardRun.id });
    }
    const grant = peer.boardGrant;
    peer.boardGrant = undefined;
    if (!grant) return;
    this.boards?.revoke(grant.grantId);
    if (!peer.socket.destroyed)
      writeFrame(peer.socket, { type: "board-revoke", grantId: grant.grantId });
  }
  revokeBoardAccess(target: Target) {
    for (const peer of this.peers) {
      if (peer.snapshot && matchesTarget(peer.snapshot, target)) this.clearBoardAccess(peer);
    }
    this.boards?.revokeTarget(target);
  }
  private async validateBoardPeer(peer: Peer, target: Target, check: () => void) {
    const snapshot = peer.snapshot;
    const validate = () => {
      check();
      if (
        !snapshot ||
        !this.boards ||
        !this.peers.has(peer) ||
        peer.socket.destroyed ||
        !peer.snapshot ||
        !matchesTarget(peer.snapshot, target) ||
        [...this.peers].filter((p) => p.snapshot?.identity.pane === snapshot.identity.pane)
          .length !== 1 ||
        resolve(snapshot.identity.herdrSocket) !== resolve(this.herdrSocket)
      )
        throw new LiveChatError(403, "Board connection is not current");
    };
    validate();
    const info = await this.inspectProcess(snapshot!.identity.pid);
    validate();
    if (
      !info.alive ||
      !info.foreground ||
      info.start !== snapshot!.identity.processStart ||
      info.pane !== snapshot!.identity.pane ||
      !info.herdrSocket ||
      resolve(info.herdrSocket) !== resolve(this.herdrSocket)
    )
      throw new LiveChatError(403, "Board agent process is no longer current");
    if (!this.boardAgent) throw new LiveChatError(503, "Board session validation unavailable");
    const agent = await this.boardAgent(snapshot!.identity.pane);
    validate();
    if (this.current(agent) !== peer)
      throw new LiveChatError(403, "Herdr and Pi board sessions do not match");
    return validate;
  }
  private async boardControl(peer: Peer, request: BoardControl) {
    if (++peer.boardRequests > 4) {
      peer.socket.destroy();
      return;
    }
    // Record the boundary synchronously, before asynchronous identity/storage work.
    // A revoked run remains a tombstone: grant retries cannot silently reauthorize it.
    if (
      request.action === "begin" &&
      peer.snapshot &&
      matchesTarget(peer.snapshot, request.target) &&
      peer.boardRun?.id !== request.runId
    ) {
      this.clearBoardAccess(peer);
      peer.boardRun = { id: request.runId, revoked: false, expiresAt: Date.now() + 15 * 60_000 };
    }
    if (request.action === "end" && peer.boardRun?.id === request.runId)
      this.clearBoardAccess(peer);
    const run = peer.boardRun;
    const checkRun = () => {
      if (request.action === "open" || request.action === "end") return;
      if (
        !run ||
        peer.boardRun !== run ||
        run.id !== request.runId ||
        run.revoked ||
        run.expiresAt <= Date.now()
      )
        throw new LiveChatError(403, "Whiteboard request ended or was revoked; send a new request");
    };
    try {
      const validate = await this.validateBoardPeer(peer, request.target, () => {
        checkRun();
        if (peer.snapshot?.version !== 2 || !peer.snapshot.capabilities?.boards)
          throw new LiveChatError(403, "Whiteboard extension capability unavailable");
      });
      let data: unknown;
      if (request.action === "begin") data = { expiresAt: run!.expiresAt };
      else if (request.action === "end") data = { revoked: true };
      else {
        let url: URL | undefined;
        if (request.action === "open") {
          const base = process.env.FERNBLICK_PUBLIC_URL;
          if (!base)
            throw new LiveChatError(
              503,
              "Set FERNBLICK_PUBLIC_URL on the backend to a browser-reachable URL, then retry /whiteboard (especially over SSH).",
            );
          url = new URL(base);
          if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
            throw new LiveChatError(
              503,
              "FERNBLICK_PUBLIC_URL must be an HTTP(S) URL without credentials",
            );
          url.search = new URLSearchParams({
            pane: peer.snapshot!.identity.pane,
            session: request.target.sessionId,
            whiteboard: "1",
          }).toString();
          url.hash = "";
        }
        const state = await this.boards!.open(boardSessionKey(peer.snapshot!), validate);
        validate();
        if (url) data = { url: url.toString() };
        else {
          // Concurrent tool calls share one lease and its idempotence ledger.
          if (!peer.boardGrant) {
            peer.boardGrant = this.boards!.grant(state.id, request.target, "edit", state.revision);
            await this.boards!.handle(
              {
                type: "board-request",
                id: randomUUID(),
                target: request.target,
                ...peer.boardGrant,
                action: "activate",
              },
              validate,
            );
            validate();
          }
          data = { grant: peer.boardGrant, expiresAt: run!.expiresAt };
        }
      }
      validate();
      writeFrame(peer.socket, { type: "board-reply", id: request.id, ok: true, data });
    } catch (error) {
      // Reply first: revocation rejects pending extension RPCs synchronously and
      // would otherwise replace the actionable error with "request revoked".
      try {
        writeFrame(peer.socket, {
          type: "board-reply",
          id: request.id,
          ok: false,
          error: error instanceof Error ? error.message.slice(0, 1024) : "Board request failed",
        });
      } finally {
        if ((request.action === "begin" || request.action === "grant") && peer.boardRun === run)
          this.clearBoardAccess(peer);
      }
    } finally {
      peer.boardRequests--;
    }
  }
  private async boardRequest(peer: Peer, request: BoardRequest) {
    if (++peer.boardRequests > 4) {
      peer.socket.destroy();
      return;
    }
    const validate = () => {
      if (
        !this.boards ||
        !this.peers.has(peer) ||
        peer.socket.destroyed ||
        !peer.snapshot ||
        !matchesTarget(peer.snapshot, request.target) ||
        peer.boardGrant?.grantId !== request.grantId ||
        (peer.boardRun && (peer.boardRun.revoked || peer.boardRun.expiresAt <= Date.now())) ||
        BoardStore.idFor(boardSessionKey(peer.snapshot)) !== request.boardId
      )
        throw new LiveChatError(403, "Board access is not authorized for this request");
    };
    try {
      validate();
      const check = await this.validateBoardPeer(peer, request.target, validate);
      const data = await this.boards!.handle(request, check, this.boardRenderer);
      await this.validateBoardPeer(peer, request.target, check);
      check();
      writeFrame(peer.socket, { type: "board-reply", id: request.id, ok: true, data });
      if (request.action === "revoke") this.clearBoardAccess(peer);
    } catch (error) {
      writeFrame(peer.socket, {
        type: "board-reply",
        id: request.id,
        ok: false,
        error: error instanceof Error ? error.message.slice(0, 1024) : "Board operation failed",
      });
    } finally {
      peer.boardRequests--;
    }
  }
  constructor(
    readonly path: string,
    private readonly herdrSocket: string,
    private readonly inspectProcess = processIdentity,
  ) {}
  async start() {
    await privateDirectory(this.path, true);
    await removeStaleSocket(this.path);
    await new Promise<void>((done, reject) => {
      this.server.once("error", reject);
      this.server.listen(this.path, () => {
        this.server.off("error", reject);
        done();
      });
    });
    await chmod(this.path, 0o600);
  }
  async close() {
    for (const peer of this.peers) peer.socket.destroy();
    await new Promise<void>((done) => this.server.close(() => done()));
  }
  subscribe(listener: () => void, pane?: string) {
    if (this.listeners.size >= 64) throw new LiveChatError(503, "Too many live chat subscribers");
    this.listeners.set(listener, pane);
    return () => {
      this.listeners.delete(listener);
    };
  }
  private notify(pane: string | undefined) {
    if (!pane) return;
    for (const [listener, filter] of this.listeners) if (!filter || filter === pane) listener();
  }
  private accept(socket: Socket) {
    if (this.peers.size >= 64) {
      socket.destroy();
      return;
    }
    const peer: Peer = { socket, boardRequests: 0 };
    this.peers.add(peer);
    const handshake = setTimeout(() => {
      if (!peer.snapshot) socket.destroy();
    }, 3000);
    handshake.unref();
    socket.on("error", () => {});
    socket.on("close", () => {
      this.clearBoardAccess(peer);
      clearTimeout(handshake);
      this.peers.delete(peer);
      for (const [id, pending] of this.pending)
        if (pending.peer === peer) {
          clearTimeout(pending.timer);
          this.pending.delete(id);
          pending.reject(
            new LiveChatError(
              409,
              "Connection lost; outcome uncertain. Draft retained. Check Pi before trying again.",
            ),
          );
        }
      this.notify(peer.snapshot?.identity.pane);
    });
    receiveFrames(socket, (raw) => {
      const control = boardControlSchema.safeParse(raw);
      if (control.success) {
        void this.boardControl(peer, control.data);
        return;
      }
      const boardRequest = boardRequestSchema.safeParse(raw);
      if (boardRequest.success) {
        void this.boardRequest(peer, boardRequest.data);
        return;
      }
      const reply = responseSchema.safeParse(raw);
      if (reply.success) {
        const pending = this.pending.get(reply.data.id);
        if (pending?.peer === peer) {
          const response = reply.data;
          const validType =
            response.type === "ack"
              ? response.outcome === "rejected" ||
                pending.command.action === "send" ||
                pending.command.action === "stop"
              : response.type === "shutdown-requested"
                ? pending.command.action === "shutdown"
                : response.type === "default-saved"
                  ? pending.command.action === "save-default"
                  : response.type === "tree-page"
                    ? pending.command.action === "tree-page"
                    : response.type === "tree"
                      ? pending.command.action === "tree"
                      : response.type === "skills"
                        ? pending.command.action === "skills"
                        : response.type === "thinking-levels"
                          ? pending.command.action === "thinking-levels"
                          : response.type === "thinking-level-changed"
                            ? pending.command.action === "set-thinking-level"
                            : response.type === "models"
                              ? pending.command.action === "models"
                              : response.type === "model-changed"
                                ? pending.command.action === "set-model"
                                : response.type === "compacted"
                                  ? pending.command.action === "compact"
                                  : pending.command.action === "navigate";
          const validTarget =
            response.type === "ack" ||
            (response.target.runtime === pending.command.target.runtime &&
              response.target.sessionId === pending.command.target.sessionId &&
              (response.type === "navigated" ||
                response.target.epoch === pending.command.target.epoch));
          const validModel =
            response.type !== "model-changed" ||
            (pending.command.action === "set-model" &&
              response.model.provider === pending.command.provider &&
              response.model.id === pending.command.modelId);
          const validThinking =
            response.type !== "thinking-level-changed" ||
            (pending.command.action === "set-thinking-level" &&
              response.provider === pending.command.provider &&
              response.modelId === pending.command.modelId &&
              response.level === pending.command.level);
          const validDefault =
            response.type !== "default-saved" ||
            (pending.command.action === "save-default" &&
              sameDefaultSelection(response.selection, pending.command.selection));
          if (!validType || !validTarget || !validModel || !validThinking || !validDefault) {
            socket.destroy();
            return;
          }
          if (
            response.type === "ack" &&
            response.outcome === "rejected" &&
            pending.command.action === "send" &&
            pending.command.board &&
            pending.command.board.grantId === peer.boardGrant?.grantId
          )
            this.clearBoardAccess(peer);
          clearTimeout(pending.timer);
          this.pending.delete(response.id);
          pending.resolve(response);
        }
        return;
      }
      const parsed = snapshotSchema.safeParse(raw);
      if (!parsed.success) {
        socket.destroy();
        return;
      }
      const next = parsed.data;
      const prev = peer.snapshot;
      if (
        prev &&
        (JSON.stringify(prev.identity) !== JSON.stringify(next.identity) ||
          (prev.epoch === next.epoch && next.seq <= prev.seq))
      ) {
        socket.destroy();
        return;
      }
      if (prev && (prev.epoch !== next.epoch || (prev.busy && !next.busy && !next.sendPending)))
        this.clearBoardAccess(peer);
      peer.snapshot = next;
      clearTimeout(handshake);
      this.notify(next.identity.pane);
    });
  }
  current(agent: Agent): Peer & { snapshot: Snapshot } {
    if (agent.agent !== "pi" || agent.agent_session?.kind !== "path")
      throw new LiveChatError(
        409,
        "A saved Pi session is required for live chat",
        (!agent.agent || agent.agent === "pi") && !agent.agent_session,
      );
    const candidates = [...this.peers].filter(
      (p) =>
        p.snapshot?.identity.pane === agent.pane_id &&
        resolve(p.snapshot.identity.herdrSocket) === resolve(this.herdrSocket),
    );
    if (candidates.length !== 1)
      throw new LiveChatError(
        409,
        candidates.length
          ? "Ambiguous Pi processes for this pane"
          : "Pi live chat extension unavailable",
        candidates.length === 0,
      );
    const peer = candidates[0];
    const snapshot = peer.snapshot!;
    if (resolve(snapshot.identity.sessionFile) !== resolve(agent.agent_session.value))
      throw new LiveChatError(409, "Herdr and Pi session identities do not match");
    return peer as Peer & { snapshot: Snapshot };
  }
  async resolve(agent: Agent): Promise<Peer & { snapshot: Snapshot }> {
    const peer = this.current(agent);
    const snapshot = peer.snapshot;
    let process;
    try {
      process = await this.inspectProcess(snapshot.identity.pid);
    } catch {
      throw new LiveChatError(409, "Pi process unavailable");
    }
    if (
      !this.peers.has(peer) ||
      this.current(agent) !== peer ||
      peer.snapshot?.epoch !== snapshot.epoch ||
      !process.alive ||
      !process.foreground ||
      process.start !== snapshot.identity.processStart ||
      process.pane !== agent.pane_id ||
      !process.herdrSocket ||
      resolve(process.herdrSocket) !== resolve(this.herdrSocket)
    )
      throw new LiveChatError(409, "Pi process mapping is stale or not foreground");
    return peer as Peer & { snapshot: Snapshot };
  }
  async command(
    agent: Agent,
    target: Target,
    action: "send" | "stop",
    text?: string,
    attachments: string[] = [],
  ) {
    return this.request(
      agent,
      target,
      action === "send" ? { action, text: text ?? "", attachments } : { action },
    );
  }
  async shutdownForRestart(agent: Agent): Promise<void> {
    const { snapshot } = await this.resolve(agent);
    const response = await this.request(agent, targetOf(snapshot), { action: "shutdown" });
    if (response.type === "ack" && response.outcome === "rejected")
      throw new LiveChatError(409, response.reason ?? "Pi refused to shut down");
    if (response.type !== "shutdown-requested")
      throw new LiveChatError(409, "No confirmed shutdown; inspect Pi before trying again");
  }

  async request(
    agent: Agent,
    target: Target,
    input:
      | {
          action: "send";
          text: string;
          attachments: string[];
          requestId?: string;
          board?: BoardGrant;
        }
      | {
          action:
            | "stop"
            | "tree"
            | "skills"
            | "compact"
            | "models"
            | "thinking-levels"
            | "shutdown";
        }
      | { action: "set-thinking-level"; provider: string; modelId: string; level: ThinkingLevel }
      | { action: "set-model"; provider: string; modelId: string }
      | { action: "save-default"; selection: DefaultSelection }
      | { action: "navigate"; entryId: string }
      | { action: "tree-page"; page: TreePageRequest },
  ) {
    const command = commandSchema.parse({
      ...input,
      type: "command",
      id: "requestId" in input ? (input.requestId ?? randomUUID()) : randomUUID(),
      target,
    });
    const peer = await this.resolve(agent);
    if (
      command.action === "send" &&
      "requestId" in input &&
      input.requestId &&
      peer.snapshot.version !== 2
    )
      throw new LiveChatError(409, "Run /reload in Pi to update the chat connection");
    if (
      (command.action === "skills" ||
        (command.action === "send" && command.text.startsWith("/skill:"))) &&
      !peer.snapshot.capabilities?.skills
    )
      throw new LiveChatError(409, "Run /reload in Pi to enable skills in Fernblick");
    if (
      (command.action === "models" || command.action === "set-model") &&
      !peer.snapshot.capabilities?.models
    )
      throw new LiveChatError(409, "Run /reload in Pi to enable model selection");
    if (
      (command.action === "thinking-levels" || command.action === "set-thinking-level") &&
      !peer.snapshot.capabilities?.thinking
    )
      throw new LiveChatError(409, "Run /reload in Pi to enable thinking level selection");
    if (command.action === "shutdown" && !peer.snapshot.capabilities?.shutdown)
      throw new LiveChatError(
        409,
        "Run /reload manually in Pi to enable safe restart; no terminal input was sent",
      );
    if (command.action === "tree-page" && !peer.snapshot.capabilities?.treePages)
      throw new LiveChatError(409, "Run /reload in Pi to browse large conversation paths");
    if (command.action === "save-default" && !peer.snapshot.capabilities?.defaults)
      throw new LiveChatError(409, "Run /reload in Pi to enable global defaults");
    if (command.action === "compact" && !peer.snapshot.capabilities?.compact)
      throw new LiveChatError(409, "Run /reload in Pi to enable conversation compaction");
    if (this.pending.has(command.id)) throw new LiveChatError(409, "Command already in flight");
    if (!matchesTarget(peer.snapshot, target))
      throw new LiveChatError(
        409,
        "Chat session changed; review the fresh snapshot before sending",
      );
    if ([...this.pending.values()].some((p) => p.peer === peer))
      throw new LiveChatError(409, "A command is already in flight");
    if (
      (command.action === "send" ||
        command.action === "shutdown" ||
        command.action === "navigate" ||
        command.action === "set-model" ||
        command.action === "set-thinking-level" ||
        command.action === "save-default" ||
        command.action === "compact") &&
      (peer.snapshot.busy || peer.snapshot.sendPending)
    )
      throw new LiveChatError(409, "Pi is busy or a previous send is unresolved");
    if (command.action === "send" && command.board && !peer.snapshot.capabilities?.boards)
      throw new LiveChatError(409, "Run /reload in Pi to enable whiteboard tools");
    if (["send", "stop", "navigate", "compact", "shutdown"].includes(command.action))
      this.clearBoardAccess(peer);
    if (command.action === "send" && command.board) {
      peer.boardRun = undefined; // Legacy explicit grant has its own bounded lease.
      peer.boardGrant = command.board;
    }
    const id = command.id;
    return new Promise<BridgeResponse>((done, reject) => {
      const timer = setTimeout(
        () => {
          this.pending.delete(id);
          reject(
            new LiveChatError(
              409,
              "No confirmed result; outcome uncertain. Draft retained. Check Pi before trying again.",
            ),
          );
          // Never retry a side-effecting command on this or another connection.
          peer.socket.destroy();
        },
        command.action === "compact" ? COMPACT_TIMEOUT_MS : 5000,
      );
      timer.unref();
      this.pending.set(id, { peer, command, resolve: done, reject, timer });
      if (!writeFrame(peer.socket, command)) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new LiveChatError(409, "Connection lost; outcome uncertain. Draft retained."));
      }
    });
  }
}
