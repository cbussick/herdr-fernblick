import { randomUUID } from "node:crypto";
import { chmod, lstat, unlink } from "node:fs/promises";
import { connect, createServer, type Socket } from "node:net";
import { resolve } from "node:path";
import type { Agent } from "../../src/shared/api/contracts.js";
import {
  responseSchema,
  commandSchema,
  matchesTarget,
  snapshotSchema,
  type BridgeResponse,
  type Command,
  type Snapshot,
  type Target,
} from "../../packages/pi-live-chat/protocol.js";
import {
  privateDirectory,
  processIdentity,
  validateSocket,
} from "../../packages/pi-live-chat/security.js";
import { receiveFrames, writeFrame } from "../../packages/pi-live-chat/transport.js";
import {
  boardRequestSchema,
  type BoardGrant,
  type BoardRequest,
} from "../../packages/pi-live-chat/boardProtocol.js";
import { BoardStore } from "../boards/storage.js";

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
  private clearBoardAccess(peer: Peer) {
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
        BoardStore.idFor(boardSessionKey(peer.snapshot)) !== request.boardId
      )
        throw new LiveChatError(403, "Board access is not authorized for this request");
    };
    try {
      validate();
      const identity = peer.snapshot!.identity;
      const info = await this.inspectProcess(identity.pid);
      validate();
      if (
        !info.alive ||
        !info.foreground ||
        info.start !== identity.processStart ||
        info.pane !== identity.pane ||
        !info.herdrSocket ||
        resolve(info.herdrSocket) !== resolve(this.herdrSocket)
      )
        throw new LiveChatError(403, "Board agent process is no longer current");
      const data = await this.boards!.handle(request, validate);
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
              "Connection lost; outcome uncertain. Draft retained. Check Pi before sending again.",
            ),
          );
        }
      this.notify(peer.snapshot?.identity.pane);
    });
    receiveFrames(socket, (raw) => {
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
              : response.type === "tree"
                ? pending.command.action === "tree"
                : pending.command.action === "navigate";
          const validTarget =
            response.type === "ack" ||
            (response.target.runtime === pending.command.target.runtime &&
              response.target.sessionId === pending.command.target.sessionId &&
              (response.type === "navigated" ||
                response.target.epoch === pending.command.target.epoch));
          if (!validType || !validTarget) {
            socket.destroy();
            return;
          }
          if (
            response.type === "ack" &&
            response.outcome === "rejected" &&
            pending.command.action === "send" &&
            pending.command.board?.grantId === peer.boardGrant?.grantId
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
      | { action: "stop" | "tree" }
      | { action: "navigate"; entryId: string },
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
    if (this.pending.has(command.id)) throw new LiveChatError(409, "Command already in flight");
    if (!matchesTarget(peer.snapshot, target))
      throw new LiveChatError(
        409,
        "Chat session changed; review the fresh snapshot before sending",
      );
    if ([...this.pending.values()].some((p) => p.peer === peer))
      throw new LiveChatError(409, "A command is already in flight");
    if (
      (command.action === "send" || command.action === "navigate") &&
      (peer.snapshot.busy || peer.snapshot.sendPending)
    )
      throw new LiveChatError(409, "Pi is busy or a previous send is unresolved");
    if (command.action === "send" && command.board && !peer.snapshot.capabilities?.boards)
      throw new LiveChatError(409, "Run /reload in Pi to enable whiteboard tools");
    if (command.action === "send" || command.action === "stop" || command.action === "navigate")
      this.clearBoardAccess(peer);
    if (command.action === "send" && command.board) peer.boardGrant = command.board;
    const id = command.id;
    return new Promise<BridgeResponse>((done, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new LiveChatError(
            409,
            "No acknowledgement; outcome uncertain. Draft retained. Check Pi before sending again.",
          ),
        );
        // Never retry a side-effecting command on this or another connection.
        peer.socket.destroy();
      }, 5000);
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
