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

export class LiveChatError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
interface Peer {
  socket: Socket;
  snapshot?: Snapshot;
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
    const peer: Peer = { socket };
    this.peers.add(peer);
    const handshake = setTimeout(() => {
      if (!peer.snapshot) socket.destroy();
    }, 3000);
    handshake.unref();
    socket.on("error", () => {});
    socket.on("close", () => {
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
      peer.snapshot = next;
      clearTimeout(handshake);
      this.notify(next.identity.pane);
    });
  }
  current(agent: Agent): Peer & { snapshot: Snapshot } {
    if (agent.agent !== "pi" || agent.agent_session?.kind !== "path")
      throw new LiveChatError(409, "A saved Pi session is required for live chat");
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
      | { action: "send"; text: string; attachments: string[] }
      | { action: "stop" | "tree" }
      | { action: "navigate"; entryId: string },
  ) {
    const command = commandSchema.parse({ ...input, type: "command", id: randomUUID(), target });
    const peer = await this.resolve(agent);
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
