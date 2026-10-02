import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { BoardStore, BoardError } from "../boards/storage.js";
import { boardSessionKey, LiveBridge, LiveChatError } from "../pi/liveBridge.js";
import type { HerdrService } from "../herdr/herdrService.js";
import {
  matchesTarget,
  targetSchema,
  uploadIdSchema,
  type Target,
} from "../../packages/pi-live-chat/protocol.js";
import {
  boardIdSchema,
  boardSceneSchema,
  MAX_BOARD_BYTES,
} from "../../packages/pi-live-chat/boardProtocol.js";
import { readImageUpload, mimeTypeForUpload } from "../uploads/imageUploads.js";
import { validatePng } from "../boards/scene.js";

function sameOrigin(request: IncomingMessage) {
  const origin = request.headers.origin;
  if (!origin || new URL(origin).host !== request.headers.host)
    throw new BoardError(403, "Cross-origin board request rejected");
}
function safeRead(request: IncomingMessage) {
  if (request.headers.origin) sameOrigin(request);
  if (request.headers["sec-fetch-site"] === "cross-site")
    throw new BoardError(403, "Cross-origin board request rejected");
}
function json(response: ServerResponse, body: unknown) {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}
async function body(request: IncomingMessage, max: number) {
  sameOrigin(request);
  if (!request.headers["content-type"]?.startsWith("application/json"))
    throw new BoardError(415, "Requests must use application/json");
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > max) throw new BoardError(413, "Board request is too large");
    chunks.push(Buffer.from(chunk));
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new BoardError(400, "Invalid board JSON");
  }
}
const openSchema = z.object({ target: targetSchema });
const ownedSchema = openSchema.extend({ boardId: boardIdSchema });
const saveSchema = ownedSchema.extend({
  baseRevision: z.number().int().nonnegative(),
  scene: boardSceneSchema,
});
const promptSchema = ownedSchema
  .extend({
    revision: z.number().int().nonnegative(),
    text: z.string().trim().min(1).max(29_000),
    uploadId: uploadIdSchema.optional(),
    requestId: z.string().uuid(),
  })
  .strict();
const sendSchema = ownedSchema.extend({
  revision: z.number().int().nonnegative(),
  uploadId: uploadIdSchema,
  mode: z.literal("image"),
  text: z.string().max(29_000),
  requestId: z.string().uuid(),
});

export function createBoardRoutes(service: HerdrService, bridge: LiveBridge, boards: BoardStore) {
  const sending = new Set<string>();
  const streams = new Set<ServerResponse>();
  async function context(pane: string, target: Target) {
    const agent = await service.getAgent(pane);
    const peer = await bridge.resolve(agent);
    const validate = () => {
      if (
        peer.socket.destroyed ||
        bridge.current(agent) !== peer ||
        !matchesTarget(peer.snapshot, target)
      )
        throw new LiveChatError(
          409,
          "Agent session changed. Reopen the whiteboard in the current chat.",
        );
    };
    validate();
    const key = boardSessionKey(peer.snapshot);
    return { agent, peer, validate, key, id: BoardStore.idFor(key) };
  }
  return async function handleBoardRoute(request: IncomingMessage, response: ServerResponse) {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    const sent = url.pathname.match(
      /^\/api\/boards\/([a-f0-9]{64})\/snapshots\/([a-f0-9-]+)\.(png|json)$/,
    );
    if (sent && request.method === "GET") {
      safeRead(request);
      const snapshot = await boards.readSnapshot(
        boardIdSchema.parse(sent[1]),
        z.string().uuid().parse(sent[2]),
      );
      response.setHeader("Cache-Control", "private, max-age=31536000, immutable");
      if (sent[3] === "png") {
        response.setHeader("Content-Type", "image/png");
        response.end(snapshot.png);
      } else {
        response.setHeader("Content-Type", "application/json; charset=utf-8");
        response.setHeader(
          "Content-Disposition",
          `attachment; filename="whiteboard-${snapshot.revision}.excalidraw"`,
        );
        response.end(
          JSON.stringify({
            type: "excalidraw",
            version: 2,
            source: "Fernblick",
            elements: snapshot.scene.elements,
            files: snapshot.scene.files,
            appState: { viewBackgroundColor: snapshot.scene.background },
          }),
        );
      }
      return true;
    }
    const route = url.pathname.match(
      /^\/api\/agents\/([^/]+)\/board(?:\/(save|send|prompt|revoke|events))?$/,
    );
    if (!route) return false;
    const pane = z
      .string()
      .max(128)
      .regex(/^[A-Za-z0-9:_-]+$/)
      .parse(decodeURIComponent(route[1]));
    const action = route[2];
    if (action === "events" && request.method === "GET") {
      safeRead(request);
      if (streams.size >= 64) throw new BoardError(503, "Too many whiteboard streams");
      const target = targetSchema.parse(Object.fromEntries(url.searchParams));
      const ctx = await context(pane, target);
      await boards.open(ctx.key);
      ctx.validate();
      response.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      streams.add(response);
      let closed = false;
      let reading = false;
      let dirty = true;
      let blocked = false;
      let blockedAt = 0;
      const unavailable = (error: unknown) => {
        if (closed) return;
        response.end(
          `data: ${JSON.stringify({ type: "unavailable", reason: error instanceof Error ? error.message : "Whiteboard disconnected" })}\n\n`,
        );
      };
      const flush = async () => {
        if (closed || reading || blocked || !dirty) return;
        reading = true;
        dirty = false;
        try {
          ctx.validate();
          const state = await boards.read(ctx.id);
          ctx.validate();
          if (closed) return;
          blocked = !response.write(
            `data: ${JSON.stringify({ type: "changed", revision: state.revision, access: state.access, lastAuthor: state.lastAuthor, snapshots: state.snapshots.length })}\n\n`,
          );
          if (blocked) blockedAt = Date.now();
        } catch (error) {
          unavailable(error);
        } finally {
          reading = false;
          if (dirty && !blocked && !closed) void flush();
        }
      };
      const notify = () => {
        dirty = true;
        void flush();
      };
      const unboard = boards.subscribe(ctx.id, notify);
      const unbridge = bridge.subscribe(() => {
        try {
          ctx.validate();
        } catch (error) {
          unavailable(error);
        }
      }, pane);
      response.on("drain", () => {
        blocked = false;
        void flush();
      });
      const timer = setInterval(() => {
        if (blocked && Date.now() - blockedAt > 60_000) response.destroy();
        if (!blocked && !closed) {
          blocked = !response.write(": keepalive\n\n");
          if (blocked) blockedAt = Date.now();
        }
      }, 15_000);
      timer.unref();
      response.on("close", () => {
        closed = true;
        clearInterval(timer);
        streams.delete(response);
        unboard();
        unbridge();
      });
      void flush();
      return true;
    }
    if (request.method !== "POST" || action === "events") return false;
    const raw = await body(request, action === "save" ? MAX_BOARD_BYTES + 65536 : 200_000);
    const input = openSchema.parse(raw);
    const ctx = await context(pane, input.target);
    if (!action) {
      const state = await boards.open(ctx.key);
      ctx.validate();
      json(response, state);
      return true;
    }
    const owned = ownedSchema.parse(raw);
    if (owned.boardId !== ctx.id)
      throw new BoardError(403, "Whiteboard does not belong to this conversation");
    if (action === "save") {
      const value = saveSchema.parse(raw);
      json(response, await boards.save(ctx.id, value.baseRevision, value.scene, ctx.validate));
    } else if (action === "revoke") {
      bridge.revokeBoardAccess(input.target);
      json(response, { ok: true });
    } else if (action === "prompt") {
      const value = promptSchema.parse(raw);
      if (sending.has(input.target.runtime))
        throw new BoardError(409, "A whiteboard send is already in flight");
      if (ctx.peer.snapshot.busy || ctx.peer.snapshot.sendPending)
        throw new BoardError(409, "Pi is busy");
      if (ctx.peer.snapshot.version !== 2 || !ctx.peer.snapshot.capabilities?.boards)
        throw new BoardError(409, "Run /reload in Pi to enable whiteboard tools");
      sending.add(input.target.runtime);
      let grant: ReturnType<BoardStore["grant"]> | undefined;
      try {
        // Visual context uses the normal image pipeline, not immutable board captures.
        if (value.uploadId) {
          if (mimeTypeForUpload(value.uploadId) !== "image/png")
            throw new BoardError(400, "Whiteboard context must be a PNG");
          try {
            validatePng(await readImageUpload(value.uploadId));
          } catch {
            throw new BoardError(
              400,
              "Whiteboard image unavailable or invalid. Refresh the board and send again.",
            );
          }
          ctx.validate();
        }
        const state = await boards.read(ctx.id);
        ctx.validate();
        if (state.revision !== value.revision)
          throw new BoardError(
            409,
            "Board changed before sending. Review it before sending again.",
          );
        if (!value.uploadId && state.scene.elements.some((element) => !element.isDeleted))
          throw new BoardError(
            400,
            "A current board image is required. Refresh the whiteboard and send again.",
          );
        grant = boards.grant(ctx.id, input.target, "edit", value.revision);
        const reply = await bridge.request(ctx.agent, input.target, {
          action: "send",
          text: value.text,
          attachments: value.uploadId ? [value.uploadId] : [],
          requestId: value.requestId,
          board: grant,
        });
        if (reply.type !== "ack" || reply.outcome !== "invoked")
          throw new BoardError(
            409,
            reply.type === "ack"
              ? (reply.reason ?? "Pi rejected the prompt")
              : "Invalid prompt acknowledgement",
          );
        json(response, reply);
      } catch (error) {
        if (grant) boards.revoke(grant.grantId);
        throw error;
      } finally {
        sending.delete(input.target.runtime);
      }
    } else if (action === "send") {
      const value = sendSchema.parse(raw);
      if (sending.has(input.target.runtime))
        throw new BoardError(409, "A whiteboard send is already in flight");
      if (ctx.peer.snapshot.busy || ctx.peer.snapshot.sendPending)
        throw new BoardError(409, "Pi is busy");
      if (ctx.peer.snapshot.version !== 2)
        throw new BoardError(409, "Run /reload in Pi to enable whiteboard sending");
      if (mimeTypeForUpload(value.uploadId) !== "image/png")
        throw new BoardError(400, "Whiteboard snapshot must be a PNG");
      sending.add(input.target.runtime);
      try {
        const png = await readImageUpload(value.uploadId);
        ctx.validate();
        const sent = await boards.capture(ctx.id, value.revision, png, ctx.validate);
        ctx.validate();
        const reply = await bridge.request(ctx.agent, input.target, {
          action: "send",
          text: `${value.text.trim() || "Please look at this whiteboard."}\n\nWhiteboard snapshot (revision ${sent.revision}): /api/boards/${ctx.id}/snapshots/${sent.id}.png\nImage only: no live board access granted.`,
          attachments: [value.uploadId],
          requestId: value.requestId,
        });
        if (reply.type !== "ack" || reply.outcome !== "invoked")
          throw new BoardError(
            409,
            reply.type === "ack"
              ? (reply.reason ?? "Pi rejected the image")
              : "Invalid image acknowledgement",
          );
        json(response, reply);
      } finally {
        sending.delete(input.target.runtime);
      }
    }
    return true;
  };
}
