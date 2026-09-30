import { randomUUID } from "node:crypto";
import { connect, type Socket } from "node:net";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { commandSchema, matchesTarget, type Identity, type Snapshot } from "./protocol.js";
import { TranscriptProjector } from "./projector.js";
import { processIdentity, socketPath, validateSocket } from "./security.js";
import { receiveFrames, writeFrame } from "./transport.js";

const singleton = Symbol.for("fernblick.pi-live-chat.owner.v1");
const owners = globalThis as typeof globalThis & { [singleton]?: object };

export default function liveChat(pi: ExtensionAPI) {
  const owner = {};
  let context: ExtensionContext | undefined;
  let identity: Identity | undefined;
  let socket: Socket | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let publishTimer: ReturnType<typeof setTimeout> | undefined;
  let generation = 0;
  let delay = 250;
  let epoch = randomUUID();
  let seq = 0;
  let active = false;
  let sendPending = false;
  let uiBlocked = false;
  let projector = new TranscriptProjector();
  const seen = new Set<string>();

  function stop() {
    generation++;
    context = undefined;
    identity = undefined;
    clearTimeout(retry);
    clearTimeout(publishTimer);
    retry = publishTimer = undefined;
    const old = socket;
    socket = undefined;
    old?.destroy();
    if (owners[singleton] === owner) delete owners[singleton];
  }
  function snapshot(): Snapshot | undefined {
    if (!context || !identity) return;
    try {
      // A retained context throws after runtime replacement. Never reuse it.
      if (
        context.sessionManager.getSessionId() !== identity.sessionId ||
        context.sessionManager.getSessionFile() !== identity.sessionFile
      ) {
        stop();
        return;
      }
      const messages = projector.messages();
      return {
        type: "snapshot",
        version: 1,
        identity,
        epoch,
        seq: ++seq,
        busy: active || uiBlocked || !context.isIdle() || context.hasPendingMessages(),
        sendPending,
        truncated: projector.truncated,
        messages,
        status: {
          cwd: context.cwd,
          model: context.model?.id,
          provider: context.model?.provider,
          totalTokens: projector.totalTokens,
          cost: projector.cost,
        },
      };
    } catch {
      stop();
      return;
    }
  }
  function publish() {
    if (publishTimer || !context) return;
    publishTimer = setTimeout(() => {
      publishTimer = undefined;
      const value = snapshot();
      if (value && socket && !socket.connecting) writeFrame(socket, value);
    }, 50);
    publishTimer.unref();
  }
  function scheduleReconnect() {
    if (!context || retry) return;
    retry = setTimeout(
      () => {
        retry = undefined;
        void open();
      },
      delay + Math.floor((Math.random() * delay) / 4),
    );
    retry.unref();
    delay = Math.min(delay * 2, 15_000);
  }
  async function open() {
    const current = generation;
    try {
      const path = socketPath();
      await validateSocket(path);
      if (!context || current !== generation) return;
      const info = await processIdentity(process.pid);
      if (!context || current !== generation) return;
      const sessionFile = context.sessionManager.getSessionFile();
      if (!sessionFile || !info.pane || !info.herdrSocket || !info.start) {
        scheduleReconnect();
        return;
      }
      identity = {
        runtime: identity?.runtime ?? randomUUID(),
        pid: process.pid,
        processStart: info.start,
        pane: info.pane,
        herdrSocket: info.herdrSocket,
        sessionId: context.sessionManager.getSessionId(),
        sessionFile,
      };
      const client = connect(path);
      socket = client;
      client.unref();
      client.on("error", () => {});
      client.on("close", () => {
        if (socket !== client || current !== generation) return;
        socket = undefined;
        scheduleReconnect();
      });
      client.on("connect", () => {
        if (!context || current !== generation) {
          client.destroy();
          return;
        }
        delay = 250;
        epoch = randomUUID();
        seq = 0;
        // Fresh authoritative history plus the still-streaming provisional overlay.
        projector.reconcile(context.sessionManager.getBranch(), true);
        const value = snapshot();
        if (value) writeFrame(client, value);
      });
      receiveFrames(client, (raw) => {
        const parsed = commandSchema.safeParse(raw);
        if (!parsed.success) {
          client.destroy();
          return;
        }
        const command = parsed.data;
        const reject = (reason: string) =>
          writeFrame(client, { type: "ack", id: command.id, outcome: "rejected", reason });
        if (client !== socket || current !== generation || !context) {
          reject("Runtime unavailable");
          return;
        }
        const value = snapshot();
        if (!value || !matchesTarget(value, command.target)) {
          reject("Stale session or connection");
          return;
        }
        if (seen.has(command.id)) {
          reject("Command already seen; never retried");
          return;
        }
        if (seen.size >= 1024) {
          reject("Command limit reached; reload Pi to reset");
          return;
        }
        seen.add(command.id);
        try {
          // No await between in-process checks and invocation. No native queue option.
          if (command.action === "send") {
            if (value.busy || sendPending) {
              reject("Pi is busy or a previous send is unresolved");
              return;
            }
            sendPending = true;
            pi.sendUserMessage(command.text, { expandPromptTemplates: false });
          } else {
            context.abort();
          }
          writeFrame(client, { type: "ack", id: command.id, outcome: "invoked" });
        } catch {
          // Even a throw cannot prove that a side effect did not start. Fail closed.
          client.destroy();
        }
        publish();
      });
    } catch {
      if (current === generation) scheduleReconnect();
    }
  }
  pi.on("session_start", (_event, ctx) => {
    if (owners[singleton] && owners[singleton] !== owner) return;
    stop();
    if (ctx.mode !== "tui") return;
    owners[singleton] = owner;
    context = ctx;
    active = !ctx.isIdle();
    sendPending = uiBlocked = false;
    seen.clear();
    projector = new TranscriptProjector();
    projector.reconcile(ctx.sessionManager.getBranch());
    void open();
  });
  pi.on("session_shutdown", () => stop());
  pi.on("agent_start", () => {
    if (!context) return;
    active = true;
    publish();
  });
  pi.on("agent_settled", (_e, ctx) => {
    if (!context) return;
    context = ctx;
    active = sendPending = false;
    projector.reconcile(ctx.sessionManager.getBranch());
    publish();
  });
  pi.on("turn_end", (_e, ctx) => {
    if (!context) return;
    context = ctx;
    projector.reconcile(ctx.sessionManager.getBranch());
    publish();
  });
  function reconcile(event: { type: string }, ctx: ExtensionContext) {
    if (!context) return;
    context = ctx;
    if (event.type === "session_tree") epoch = randomUUID();
    projector.reconcile(ctx.sessionManager.getBranch(), event.type !== "session_tree");
    publish();
  }
  pi.on("session_tree", reconcile);
  pi.on("session_compact", reconcile);
  pi.on("model_select", reconcile);
  pi.on("session_info_changed", reconcile);
  function message(event: { message: unknown }) {
    if (!context) return;
    projector.message(event.message);
    publish();
  }
  pi.on("message_start", message);
  pi.on("message_update", message);
  pi.on("message_end", message);
  function tool(event: Parameters<TranscriptProjector["tool"]>[0]) {
    if (!context) return;
    projector.tool(event);
    publish();
  }
  pi.on("tool_execution_start", tool);
  pi.on("tool_execution_update", tool);
  pi.on("tool_execution_end", tool);
  pi.on("ui_prompt_start", () => {
    if (!context) return;
    uiBlocked = true;
    publish();
  });
  pi.on("ui_prompt_end", () => {
    if (!context) return;
    uiBlocked = false;
    publish();
  });
}
