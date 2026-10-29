import { randomUUID } from "node:crypto";
import { connect, type Socket } from "node:net";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  commandSchema,
  agentModelSchema,
  footerPublicationSchema,
  footerRequestEvent,
  footerUpdateEvent,
  matchesTarget,
  MAX_TEXT,
  type Command,
  type Identity,
  type Snapshot,
} from "./protocol.js";
import { thinkingState } from "./thinking.js";
import { globalDefaultInfo, saveGlobalDefault } from "./globalDefaults.js";
import { ImageHistory, IMAGE_METADATA } from "./imageHistory.js";
import { TranscriptProjector } from "./projector.js";
import { prepareImages } from "./images.js";
import { skillCatalog, skillPrompt } from "./skills.js";
import { projectTree, contentText, matchesNavigationDestination } from "./tree.js";
import { readTreePage } from "./treePage.js";
import { processIdentity, socketPath, validateSocket } from "./security.js";
import { receiveFrames, writeFrame } from "./transport.js";
import { BoardTools, type BoardConnection } from "./boardTools.js";
import { openWhiteboardCommand } from "./whiteboardCommand.js";

const singleton = Symbol.for("fernblick.pi-live-chat.owner.v1");
const owners = globalThis as typeof globalThis & { [singleton]?: object };

export default function liveChat(pi: ExtensionAPI) {
  const owner = {};
  const privateCommand = `fernblick-bridge-${randomUUID().replaceAll("-", "")}`;
  let context: ExtensionContext | undefined;
  let footerLines: string[] | undefined;

  pi.events.on(footerUpdateEvent, (raw: unknown) => {
    if (!context) return;
    const parsed = footerPublicationSchema.safeParse(raw);
    if (!parsed.success) return;
    try {
      if (
        parsed.data.sessionId !== context.sessionManager.getSessionId() ||
        parsed.data.sessionFile !== context.sessionManager.getSessionFile()
      )
        return;
      footerLines = parsed.data.lines ?? undefined;
      publish();
    } catch {
      stop();
    }
  });

  function requestFooter() {
    footerLines = undefined;
    if (!context) return;
    pi.events.emit(footerRequestEvent, {
      sessionId: context.sessionManager.getSessionId(),
      sessionFile: context.sessionManager.getSessionFile(),
    });
  }
  let boards: BoardTools | undefined;
  let identity: Identity | undefined;
  let socket: Socket | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let publishTimer: ReturnType<typeof setTimeout> | undefined;
  let publishStallTimer: ReturnType<typeof setTimeout> | undefined;
  let publishPending = false;
  let generation = 0;
  let inputGeneration = 0;
  let delay = 250;
  let epoch = randomUUID();
  let seq = 0;
  let active = false;
  let compacting = false;
  let sendPending = false;
  let handoffTimer: ReturnType<typeof setTimeout> | undefined;
  let preparing = false;
  let shuttingDown = false;
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
    inputGeneration++;
    boards?.input(event);
    if (event.text.startsWith("/fernblick-bridge")) return { action: "handled" };
  });
  pi.on("before_agent_start", (event, ctx) => boards?.beforeAgentStart(event.prompt, ctx, event));
  pi.registerCommand("whiteboard", {
    description: "Open this conversation's Fernblick whiteboard without sending a prompt",
    handler: async (_args, ctx) => {
      if (owners[singleton] !== owner) return;
      await openWhiteboardCommand(ctx, () => {
        if (!boards)
          throw new Error(
            "Whiteboard backend unavailable. Configure Fernblick and its Pi socket first.",
          );
        return boards.open(ctx);
      });
    },
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
        // Pi itself selects a user's parent (including null/root).
        const result = await ctx.navigateTree(entry.id, { summarize: false });
        if (result.cancelled) throw new Error("Navigation cancelled");
        if (
          operation.expired ||
          navigation !== operation ||
          operation.generation !== generation ||
          operation.client !== socket ||
          operation.client.destroyed ||
          ctx.sessionManager.getSessionId() !== operation.command.target.sessionId ||
          !matchesNavigationDestination(ctx.sessionManager, expectedLeaf)
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

  function finishHandoff() {
    clearTimeout(handoffTimer);
    handoffTimer = undefined;
    sendPending = false;
  }
  function stop() {
    boards?.revoke("Whiteboard session stopped");
    boards = undefined;
    generation++;
    finishHandoff();
    if (navigation) {
      navigation.expired = true;
      navigation.nonce = undefined;
      clearTimeout(navigation.timer);
      navigation = undefined;
    }
    context = undefined;
    footerLines = undefined;
    identity = undefined;
    preparing = false;
    shuttingDown = false;
    compacting = false;
    clearTimeout(retry);
    clearTimeout(publishTimer);
    clearTimeout(publishStallTimer);
    retry = publishTimer = publishStallTimer = undefined;
    publishPending = false;
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
        version: 2,
        capabilities: {
          boards: true,
          skills: true,
          compact: true,
          models: true,
          thinking: true,
          defaults: true,
          treePages: true,
          shutdown: true,
        },
        identity,
        epoch,
        seq: ++seq,
        busy:
          active || compacting || uiBlocked || !context.isIdle() || context.hasPendingMessages(),
        compacting,
        sendPending: sendPending || preparing,
        truncated: projector.truncated,
        messages,
        status: {
          footerLines,
          cwd: context.cwd,
          model: context.model?.id,
          provider: context.model?.provider,
          thinkingLevel: pi.getThinkingLevel(),
          totalTokens: projector.totalTokens,
          cost: projector.cost,
        },
      };
    } catch {
      stop();
      return;
    }
  }
  function boardConnection(): BoardConnection | undefined {
    if (owners[singleton] !== owner || !context || !identity || !socket) return;
    try {
      if (
        context.sessionManager.getSessionId() !== identity.sessionId ||
        context.sessionManager.getSessionFile() !== identity.sessionFile
      )
        return;
      return {
        client: socket,
        target: {
          runtime: identity.runtime,
          epoch,
          sessionId: identity.sessionId,
        },
        sessionFile: identity.sessionFile,
      };
    } catch {
      return;
    }
  }
  function writeSnapshot(client: Socket, value: Snapshot) {
    if (!writeFrame(client, value) || !client.writableNeedDrain || publishStallTimer) return;
    // Brief stalls coalesce; a permanently stalled backend still loses its peer.
    publishStallTimer = setTimeout(() => {
      publishStallTimer = undefined;
      if (socket === client) client.destroy();
    }, 60_000);
    publishStallTimer.unref();
  }
  function publish() {
    if (!context) return;
    publishPending = true;
    if (publishTimer || !socket || socket.connecting || socket.writableNeedDrain) return;
    publishTimer = setTimeout(() => {
      publishTimer = undefined;
      if (!publishPending || !socket || socket.connecting || socket.writableNeedDrain) return;
      // Keep only a dirty bit while backpressured, never another full transcript.
      publishPending = false;
      const value = snapshot();
      if (value && socket) writeSnapshot(socket, value);
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
      boards?.revoke("Whiteboard connection replaced");
      const client = connect(path);
      socket = client;
      client.unref();
      client.on("error", () => {});
      client.on("drain", () => {
        if (socket !== client || current !== generation) return;
        clearTimeout(publishStallTimer);
        publishStallTimer = undefined;
        if (publishPending) publish();
      });
      client.on("close", () => {
        if (socket !== client || current !== generation) return;
        clearTimeout(publishStallTimer);
        publishStallTimer = undefined;
        boards?.revoke("Whiteboard socket disconnected");
        socket = undefined;
        scheduleReconnect();
      });
      client.on("connect", () => {
        if (!context || current !== generation) {
          client.destroy();
          return;
        }
        boards?.revoke("Whiteboard connection renewed");
        delay = 250;
        epoch = randomUUID();
        seq = 0;
        // Fresh authoritative history plus the still-streaming provisional overlay.
        projector.reconcile(context.sessionManager.getBranch(), true);
        requestFooter();
        publishPending = false;
        const value = snapshot();
        if (value) writeSnapshot(client, value);
      });
      receiveFrames(client, (raw) => {
        if (boards?.consume(raw, client)) return;
        const parsed = commandSchema.safeParse(raw);
        if (!parsed.success) {
          client.destroy();
          return;
        }
        const command = parsed.data;
        const reject = (reason: string) =>
          writeFrame(client, {
            type: "ack",
            id: command.id,
            outcome: "rejected",
            reason,
          });
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
        if (shuttingDown) {
          reject("Pi is shutting down");
          return;
        }
        // Stop revokes permission immediately, including during async preparation.
        if (command.action === "stop") {
          inputGeneration++;
          boards?.revoke("Whiteboard access stopped by user");
        }
        if (preparing && command.action !== "stop") {
          reject("A command is already in flight");
          return;
        }
        if (command.action === "shutdown") {
          try {
            if (value.busy || sendPending)
              throw new Error("Pi is busy or a previous send is unresolved");
            if (
              typeof context.ui?.getEditorText !== "function" ||
              typeof context.shutdown !== "function"
            )
              throw new Error("Cannot safely inspect or shut down this Pi runtime");
            if (context.ui.getEditorText().length > 0)
              throw new Error(
                "Pi terminal has an unsent draft. Save or clear it in Pi before exiting or restarting; nothing was submitted or discarded.",
              );
            preparing = shuttingDown = true;
            // Confirmation means the shutdown was requested, not that Pi exited.
            // The backend must also observe the old agent disappear before restart.
            if (
              !writeFrame(client, {
                type: "shutdown-requested",
                id: command.id,
                target: command.target,
              })
            ) {
              preparing = shuttingDown = false;
              return;
            }
            context.shutdown();
          } catch (error) {
            preparing = shuttingDown = false;
            reject(error instanceof Error ? error.message.slice(0, 512) : "Shutdown unavailable");
          }
          return;
        }
        if (command.action === "skills") {
          try {
            writeFrame(client, {
              type: "skills",
              id: command.id,
              target: command.target,
              ...skillCatalog(pi),
            });
          } catch {
            reject("Skills unavailable in this Pi session");
          }
          return;
        }
        if (command.action === "save-default") {
          if (value.busy || sendPending) {
            reject("Pi is busy or a previous send is unresolved");
            return;
          }
          const ctx = context;
          preparing = true;
          void (async () => {
            try {
              const selection = command.selection;
              if (selection.kind === "thinking") {
                const state = thinkingState(pi, ctx);
                if (state.provider !== selection.provider || state.modelId !== selection.modelId)
                  throw new Error("Model changed. Reopen Thinking level.");
                if (!state.levels.includes(selection.level))
                  throw new Error("This thinking level is not supported by the current model");
              } else if (
                !ctx.modelRegistry
                  .getAvailable()
                  .some(
                    (model) =>
                      model.provider === selection.provider && model.id === selection.modelId,
                  )
              ) {
                throw new Error("Model is no longer available in Pi");
              }
              // Save any available model / supported level directly from its
              // row, without changing the live session or accepting file paths.
              await saveGlobalDefault(ctx.cwd, selection);
              const fresh = snapshot();
              if (
                current !== generation ||
                client !== socket ||
                client.destroyed ||
                !fresh ||
                !matchesTarget(fresh, command.target)
              )
                throw new Error(
                  "Default save outcome uncertain. Check Pi settings before trying again.",
                );
              writeFrame(client, {
                type: "default-saved",
                id: command.id,
                target: command.target,
                selection,
              });
            } catch (error) {
              if (current === generation && client === socket && !client.destroyed)
                reject(
                  error instanceof Error ? error.message.slice(0, 512) : "Default save failed",
                );
            } finally {
              if (current === generation) {
                preparing = false;
                publish();
              }
            }
          })();
          publish();
          return;
        }
        if (command.action === "thinking-levels") {
          try {
            writeFrame(client, {
              type: "thinking-levels",
              id: command.id,
              target: command.target,
              ...thinkingState(pi, context),
              ...globalDefaultInfo(context.cwd),
            });
          } catch (error) {
            reject(
              error instanceof Error ? error.message.slice(0, 512) : "Thinking levels unavailable",
            );
          }
          return;
        }
        if (command.action === "set-thinking-level") {
          if (value.busy || sendPending) {
            reject("Pi is busy or a previous send is unresolved");
            return;
          }
          preparing = true;
          try {
            const state = thinkingState(pi, context);
            if (state.provider !== command.provider || state.modelId !== command.modelId)
              throw new Error("Model changed. Reopen Thinking level.");
            if (!state.levels.includes(command.level))
              throw new Error("This thinking level is not supported by the current model");
            // Pi's public setter is synchronous; no await between validation,
            // invocation and reading the effective level.
            pi.setThinkingLevel(command.level);
            const fresh = snapshot();
            if (
              !fresh ||
              !matchesTarget(fresh, command.target) ||
              fresh.status.provider !== command.provider ||
              fresh.status.model !== command.modelId ||
              pi.getThinkingLevel() !== command.level
            )
              throw new Error(
                "Thinking level change outcome uncertain. Check Pi before trying again.",
              );
            requestFooter();
            writeFrame(client, {
              type: "thinking-level-changed",
              id: command.id,
              target: command.target,
              provider: command.provider,
              modelId: command.modelId,
              level: command.level,
            });
          } catch (error) {
            reject(
              error instanceof Error ? error.message.slice(0, 512) : "Thinking level change failed",
            );
          } finally {
            preparing = false;
            publish();
          }
          return;
        }
        if (command.action === "models") {
          try {
            // Only public display metadata crosses the socket, never credentials,
            // endpoints, headers or provider configuration.
            const models = context.modelRegistry.getAvailable();
            writeFrame(client, {
              type: "models",
              id: command.id,
              target: command.target,
              models: models.slice(0, 1000).map((model) =>
                agentModelSchema.parse({
                  id: model.id,
                  provider: model.provider,
                  name: model.name,
                }),
              ),
              truncated: models.length > 1000,
              ...globalDefaultInfo(context.cwd),
            });
          } catch {
            reject("Models unavailable in this Pi session");
          }
          return;
        }
        if (command.action === "set-model") {
          if (value.busy || sendPending) {
            reject("Pi is busy or a previous send is unresolved");
            return;
          }
          preparing = true;
          void (async () => {
            try {
              const model = context!.modelRegistry
                .getAvailable()
                .find(
                  (model) => model.provider === command.provider && model.id === command.modelId,
                );
              if (!model) throw new Error("Model is no longer available in Pi");
              // No await between validating this session and invoking the native API.
              if (!(await pi.setModel(model)))
                throw new Error("Model authentication is unavailable");
              const fresh = snapshot();
              if (
                current !== generation ||
                client !== socket ||
                client.destroyed ||
                !fresh ||
                !matchesTarget(fresh, command.target) ||
                fresh.status.model !== model.id ||
                fresh.status.provider !== model.provider
              )
                throw new Error("Model change outcome uncertain. Check Pi before trying again.");
              requestFooter();
              writeFrame(client, {
                type: "model-changed",
                id: command.id,
                target: command.target,
                model: { id: model.id, provider: model.provider, name: model.name },
              });
            } catch (error) {
              if (current === generation && client === socket && !client.destroyed)
                reject(
                  error instanceof Error ? error.message.slice(0, 512) : "Model change failed",
                );
            } finally {
              // Retain serialization over disconnect until the native operation settles.
              if (current === generation) {
                preparing = false;
                publish();
              }
            }
          })();
          publish();
          return;
        }
        if (command.action === "tree-page") {
          try {
            writeFrame(client, {
              type: "tree-page",
              id: command.id,
              target: command.target,
              page: readTreePage(context.sessionManager, command.page),
            });
          } catch (error) {
            reject(
              error instanceof Error
                ? error.message.slice(0, 512)
                : "Conversation paths unavailable",
            );
          }
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
        if (command.action === "compact") {
          if (value.busy || sendPending) {
            reject("Pi is busy or a previous send is unresolved");
            return;
          }
          // compact() returns void and aborts active work internally. Guard before
          // invocation, then retain serialization until a terminal callback, even
          // if the socket disconnects or the backend deadline expires.
          preparing = true;
          boards?.revoke("Whiteboard context is compacting");
          let settled = false;
          const finish = (error?: Error) => {
            if (settled) return;
            settled = true;
            if (current !== generation) return;
            const fresh = snapshot();
            if (!fresh) return;
            const valid =
              client === socket && !client.destroyed && matchesTarget(fresh, command.target);
            preparing = false;
            if (!valid && client === socket && !client.destroyed)
              reject(
                "Session changed; compaction outcome uncertain. Check Pi before trying again.",
              );
            if (valid) {
              if (error) reject(error.message.slice(0, 512));
              else {
                projector.reconcile(context!.sessionManager.getBranch());
                requestFooter();
                writeFrame(client, { type: "compacted", id: command.id, target: command.target });
              }
            }
            publish();
          };
          publish();
          try {
            context.compact({ onComplete: () => finish(), onError: finish });
          } catch (error) {
            finish(error instanceof Error ? error : new Error("Compaction failed"));
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
          const inputAtPreparation = inputGeneration;
          void (async () => {
            let invoked = false;
            let boardStaged = false;
            try {
              const images = await prepareImages(command.attachments);
              const fresh = snapshot();
              // Async preparation is not an acceptance or queue. Recheck immediately.
              if (
                current !== generation ||
                inputAtPreparation !== inputGeneration ||
                client !== socket ||
                client.destroyed ||
                !fresh ||
                !matchesTarget(fresh, command.target)
              )
                throw new Error("Stale session or connection");
              if (fresh.busy || sendPending)
                throw new Error("Pi is busy or a previous send is unresolved");
              const prompt = skillPrompt(pi, command.text);
              if (images.length)
                pi.appendEntry(IMAGE_METADATA, imageHistory.remember(images, command.attachments));
              sendPending = true;
              // Prevent rapid double submission during Pi's async input preflight.
              // This is a bounded handoff guard, not a delivery receipt or queue.
              handoffTimer = setTimeout(() => {
                finishHandoff();
                publish();
              }, 15_000);
              handoffTimer.unref();
              // Stage only after image preparation and final target/busy checks.
              // The token stays in this private socket scope, never in model input.
              boards?.revoke("Whiteboard request replaced by a new send");
              if (command.board) {
                const binding = boardConnection();
                if (!boards || !binding) throw new Error("Whiteboard tools unavailable");
                boards.stage(command.board, command.text, binding);
                boardStaged = true;
              }
              invoked = true;
              pi.sendUserMessage(
                images.length
                  ? [
                      ...(prompt.text ? [{ type: "text" as const, text: prompt.text }] : []),
                      ...images,
                    ]
                  : prompt.text,
                { expandPromptTemplates: prompt.expandPromptTemplates },
              );
              writeFrame(client, {
                type: "ack",
                id: command.id,
                outcome: "invoked",
              });
            } catch (error) {
              if (boardStaged && current === generation && client === socket)
                boards?.revoke("Whiteboard send failed");
              if (invoked) client.destroy();
              else {
                if (current === generation) finishHandoff();
                reject(
                  error instanceof Error ? error.message.slice(0, 512) : "Image preparation failed",
                );
              }
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
            writeFrame(client, {
              type: "ack",
              id: command.id,
              outcome: "invoked",
            });
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
    requestFooter();
    boards = new BoardTools(pi, boardConnection);
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
  pi.on("agent_start", (_event, ctx) => {
    if (!context) return;
    boards?.agentStart(ctx);
    active = true;
    finishHandoff();
    publish();
  });
  pi.on("agent_settled", (_e, ctx) => {
    if (!context) return;
    boards?.revoke("Whiteboard request settled");
    context = ctx;
    active = false;
    finishHandoff();
    projector.reconcile(ctx.sessionManager.getBranch());
    publish();
  });
  pi.on("turn_end", (_e, ctx) => {
    if (!context) return;
    context = ctx;
    projector.reconcile(ctx.sessionManager.getBranch());
    requestFooter();
    publish();
  });
  function reconcile(event: { type: string }, ctx: ExtensionContext) {
    if (!context) return;
    inputGeneration++;
    boards?.revoke("Whiteboard context changed");
    context = ctx;
    if (event.type === "session_compact") compacting = false;
    if (event.type === "session_tree") epoch = randomUUID();
    projector.reconcile(ctx.sessionManager.getBranch(), event.type !== "session_tree");
    requestFooter();
    publish();
  }
  const revokeBoardContext = () => {
    inputGeneration++;
    boards?.revoke("Whiteboard context is changing");
  };
  pi.on("session_before_switch", revokeBoardContext);
  pi.on("session_before_fork", revokeBoardContext);
  pi.on("session_before_tree", revokeBoardContext);
  pi.on("session_before_compact", (_event, ctx) => {
    revokeBoardContext();
    if (!context) return;
    context = ctx;
    compacting = true;
    publish();
  });
  pi.on("session_tree", reconcile);
  pi.on("session_compact", reconcile);
  pi.on("session_compact_failed", (_event, ctx) => {
    if (!context) return;
    context = ctx;
    compacting = false;
    publish();
  });
  pi.on("model_select", reconcile);
  pi.on("thinking_level_select", reconcile);
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
