import { randomUUID } from "node:crypto";
import { connect, type Socket } from "node:net";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  commandSchema,
  matchesTarget,
  MAX_TEXT,
  type Command,
  type Identity,
  type Snapshot,
} from "./protocol.js";
import { ImageHistory, IMAGE_METADATA } from "./imageHistory.js";
import { TranscriptProjector } from "./projector.js";
import { prepareImages } from "./images.js";
import { projectTree, contentText } from "./tree.js";
import { processIdentity, socketPath, validateSocket } from "./security.js";
import { receiveFrames, writeFrame } from "./transport.js";

const singleton = Symbol.for("fernblick.pi-live-chat.owner.v1");
const owners = globalThis as typeof globalThis & { [singleton]?: object };

export default function liveChat(pi: ExtensionAPI) {
  const owner = {};
  const privateCommand = `fernblick-bridge-${randomUUID().replaceAll("-", "")}`;
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
  let preparing = false;
  let uiBlocked = false;
  let imageHistory = new ImageHistory();
  let projector = new TranscriptProjector(imageHistory.url);
  const seen = new Set<string>();
  let navigation:
    | {
        nonce?: string;
        command: Extract<Command, { action: "navigate" }>;
        client: Socket;
        generation: number;
        timer: ReturnType<typeof setTimeout>;
        expired: boolean;
        entered: boolean;
      }
    | undefined;

  // Commands are instance-unique so global + explicit loads cannot steal dispatch.
  // The fallback guard also consumes a token deferred across reload or shutdown.
  pi.on("input", (event) => {
    if (event.text.startsWith("/fernblick-bridge")) return { action: "handled" };
  });
  pi.registerCommand(privateCommand, {
    description: "Private one-use Fernblick navigation gateway",
    handler: async (args, ctx) => {
      const operation = navigation;
      if (!operation || !operation.nonce || args.trim() !== operation.nonce) return;
      operation.nonce = undefined;
      operation.entered = true;
      const reject = (reason: string) =>
        writeFrame(operation.client, {
          type: "ack",
          id: operation.command.id,
          outcome: "rejected",
          reason,
        });
      try {
        const fresh = snapshot();
        if (
          operation.expired ||
          owners[singleton] !== owner ||
          operation.generation !== generation ||
          operation.client !== socket ||
          operation.client.destroyed ||
          !fresh ||
          !matchesTarget(fresh, operation.command.target) ||
          ctx.sessionManager.getSessionId() !== operation.command.target.sessionId
        )
          throw new Error("Stale navigation request");
        if (fresh.busy || sendPending || !ctx.isIdle() || ctx.hasPendingMessages())
          throw new Error("Pi is busy");
        const entry = ctx.sessionManager.getEntry(operation.command.entryId);
        if (
          entry?.type !== "message" ||
          (entry.message.role !== "user" && entry.message.role !== "assistant")
        )
          throw new Error("Conversation entry is unavailable");
        const prompt =
          entry.message.role === "user"
            ? {
                text: contentText(entry.message.content),
                attachments: imageHistory.ids(entry.message),
              }
            : undefined;
        if (prompt && prompt.text.length > MAX_TEXT)
          throw new Error("Prompt is too large to restore");
        const expectedLeaf = entry.message.role === "user" ? entry.parentId : entry.id;
        // Pi 0.99.1 itself selects a user's parent (including null/root).
        const result = await ctx.navigateTree(entry.id, { summarize: false });
        if (result.cancelled) throw new Error("Navigation cancelled");
        if (
          operation.expired ||
          navigation !== operation ||
          operation.generation !== generation ||
          operation.client !== socket ||
          operation.client.destroyed ||
          ctx.sessionManager.getSessionId() !== operation.command.target.sessionId ||
          ctx.sessionManager.getLeafId() !== expectedLeaf
        )
          throw new Error("Navigation outcome changed or connection lost; inspect Pi");
        epoch = randomUUID();
        projector.reconcile(ctx.sessionManager.getBranch());
        writeFrame(operation.client, {
          type: "navigated",
          id: operation.command.id,
          target: { ...operation.command.target, epoch },
          prompt,
        });
      } catch (error) {
        if (!operation.expired)
          reject(error instanceof Error ? error.message.slice(0, 512) : "Navigation failed");
      } finally {
        clearTimeout(operation.timer);
        if (navigation === operation) {
          navigation = undefined;
          preparing = false;
          publish();
        }
      }
    },
  });

  function stop() {
    generation++;
    if (navigation) {
      navigation.expired = true;
      navigation.nonce = undefined;
      clearTimeout(navigation.timer);
      navigation = undefined;
    }
    context = undefined;
    identity = undefined;
    preparing = false;
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
        sendPending: sendPending || preparing,
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
        if (preparing) {
          reject("A command is already in flight");
          return;
        }
        if (command.action === "tree") {
          try {
            writeFrame(client, {
              type: "tree",
              id: command.id,
              target: command.target,
              tree: projectTree(context.sessionManager),
            });
          } catch (error) {
            reject(error instanceof Error ? error.message : "Tree unavailable");
          }
          return;
        }
        if (command.action === "navigate") {
          if (value.busy || sendPending) {
            reject("Pi is busy or a previous send is unresolved");
            return;
          }
          if (!pi.getCommands().some((c) => c.name === privateCommand)) {
            reject("Navigation handler unavailable");
            return;
          }
          preparing = true;
          const operation = {
            nonce: randomUUID() as string | undefined,
            command,
            client,
            generation: current,
            expired: false,
            entered: false,
            timer: setTimeout(() => {
              operation.expired = true;
              operation.nonce = undefined;
              reject("Navigation timed out; outcome uncertain. Inspect Pi before retrying.");
              client.destroy();
              if (!operation.entered && navigation === operation) {
                navigation = undefined;
                preparing = false;
              }
            }, 4000),
          };
          operation.timer.unref();
          navigation = operation;
          try {
            pi.sendUserMessage(`/${privateCommand} ${operation.nonce}`, {
              expandPromptTemplates: true,
            });
          } catch {
            clearTimeout(operation.timer);
            navigation = undefined;
            preparing = false;
            reject("Navigation gateway invocation failed");
          }
          publish();
          return;
        }
        if (command.action === "send") {
          if (value.busy || sendPending) {
            reject("Pi is busy or a previous send is unresolved");
            return;
          }
          if (!command.text && !command.attachments.length) {
            reject("Message or image required");
            return;
          }
          preparing = true;
          void (async () => {
            let invoked = false;
            try {
              const images = await prepareImages(command.attachments);
              const fresh = snapshot();
              // Async preparation is not an acceptance or queue. Recheck immediately.
              if (
                current !== generation ||
                client !== socket ||
                client.destroyed ||
                !fresh ||
                !matchesTarget(fresh, command.target)
              )
                throw new Error("Stale session or connection");
              if (fresh.busy || sendPending)
                throw new Error("Pi is busy or a previous send is unresolved");
              if (images.length)
                pi.appendEntry(IMAGE_METADATA, imageHistory.remember(images, command.attachments));
              sendPending = true;
              invoked = true;
              pi.sendUserMessage(
                images.length
                  ? [
                      ...(command.text ? [{ type: "text" as const, text: command.text }] : []),
                      ...images,
                    ]
                  : command.text,
                { expandPromptTemplates: false },
              );
              writeFrame(client, { type: "ack", id: command.id, outcome: "invoked" });
            } catch (error) {
              if (invoked) client.destroy();
              else
                reject(
                  error instanceof Error ? error.message.slice(0, 512) : "Image preparation failed",
                );
            } finally {
              if (current === generation) {
                preparing = false;
                publish();
              }
            }
          })();
        } else {
          try {
            context.abort();
            writeFrame(client, { type: "ack", id: command.id, outcome: "invoked" });
          } catch {
            client.destroy();
          }
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
    imageHistory = new ImageHistory();
    imageHistory.restore(ctx.sessionManager.getEntries());
    projector = new TranscriptProjector(imageHistory.url);
    projector.reconcile(ctx.sessionManager.getBranch());
    hydrateHistory();
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
  function hydrateMessage(value: unknown) {
    const current = generation;
    const catalog = imageHistory;
    const valid = () => current === generation && Boolean(context);
    void catalog
      .hydrate(value, valid, (refs) => pi.appendEntry(IMAGE_METADATA, refs))
      .then((changed) => {
        if (!changed || !valid() || !context) return;
        projector.reconcile(context.sessionManager.getBranch(), true);
        projector.message(value);
        publish();
      })
      .catch(() => {});
  }
  function hydrateHistory() {
    if (!context) return;
    // Uploaded originals resolve immediately from metadata. Limit unsolicited copies.
    for (const entry of context.sessionManager.getBranch().slice(-16))
      if (entry.type === "message") hydrateMessage(entry.message);
  }
  function message(event: { message: unknown }) {
    if (!context) return;
    projector.message(event.message);
    hydrateMessage(event.message);
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
