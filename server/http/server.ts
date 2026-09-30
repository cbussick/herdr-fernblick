import { createReadStream, existsSync, statSync } from "node:fs";
import { type IncomingMessage, type ServerResponse, createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { z } from "zod";
import {
  createAgentRequestSchema,
  createTabRequestSchema,
  createWorkspaceRequestSchema,
  keyRequestSchema,
  paneInputRequestSchema,
  renameAgentRequestSchema,
  renameTabRequestSchema,
} from "../../src/shared/api/contracts.js";
import { HerdrRequestError } from "../herdr/HerdrClient.js";
import {
  mimeTypeForUpload,
  readImageUpload,
  saveImageUpload,
  uploadIdPattern,
} from "../uploads/imageUploads.js";
import type { HerdrService } from "../herdr/herdrService.js";
import { LiveBridge, LiveChatError } from "../pi/liveBridge.js";
import { liveEvents } from "../pi/liveEvents.js";
import {
  targetSchema as chatTargetSchema,
  sendInputSchema,
  MAX_IMAGE_BYTES,
} from "../../packages/pi-live-chat/protocol.js";
const chatCommandSchema = sendInputSchema.safeExtend({
  target: chatTargetSchema,
  requestId: z.string().uuid().optional(),
});
const treeRequestSchema = z.object({
  target: chatTargetSchema,
  entryId: z.string().min(1).max(256).optional(),
});

const MAX_BODY_BYTES = 40_000;
const targetSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9:_-]+$/);
const linesSchema = z.coerce.number().int().min(20).max(2_000).default(400);

const contentTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
};

function setSecurityHeaders(response: ServerResponse) {
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; connect-src 'self'; img-src 'self' blob: data:; style-src 'self'; script-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  );
  response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  response.setHeader("Permissions-Policy", "camera=(), geolocation=(), microphone=()");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("X-Content-Type-Options", "nosniff");
}

function sendJson(response: ServerResponse, status: number, body: unknown) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}

async function readJson(request: IncomingMessage) {
  if (!request.headers["content-type"]?.startsWith("application/json")) {
    throw new HttpError(415, "Requests must use application/json");
  }

  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, "Request is too large");
    chunks.push(buffer);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new HttpError(400, "Request body is not valid JSON");
  }
}

async function readBytes(request: IncomingMessage, limit: number) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > limit) throw new HttpError(413, "Image is too large");
    chunks.push(buffer);
  }
  if (!size) throw new HttpError(400, "Image is empty");
  return Buffer.concat(chunks);
}

function requireSameOrigin(request: IncomingMessage) {
  const origin = request.headers.origin;
  const host = request.headers.host;
  if (!origin || !host) throw new HttpError(403, "Missing request origin");

  const originUrl = new URL(origin);
  if (originUrl.host !== host) throw new HttpError(403, "Cross-origin request rejected");
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function getAgentRoute(pathname: string) {
  const match = pathname.match(
    /^\/api\/agents\/([^/]+)(?:\/(output|chat|prompt|stop|tree|tree-navigation|keys|restart))?$/,
  );
  if (!match) return null;

  const target = targetSchema.safeParse(decodeURIComponent(match[1]));
  if (!target.success) throw new HttpError(400, "Invalid agent target");

  return { target: target.data, action: match[2] };
}

function getPaneRoute(pathname: string) {
  const match = pathname.match(/^\/api\/panes\/([^/]+)\/(output|input|keys)$/);
  if (!match) return null;
  const paneId = targetSchema.safeParse(decodeURIComponent(match[1]));
  if (!paneId.success) throw new HttpError(400, "Invalid pane target");
  return { paneId: paneId.data, action: match[2] };
}

function getTabTarget(pathname: string) {
  const match = pathname.match(/^\/api\/tabs\/([^/]+)$/);
  if (!match) return null;
  const tabId = targetSchema.safeParse(decodeURIComponent(match[1]));
  if (!tabId.success) throw new HttpError(400, "Invalid tab target");
  return tabId.data;
}

async function handleApi(
  request: IncomingMessage,
  response: ServerResponse,
  service: HerdrService,
  bridge: LiveBridge,
) {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

  const uploadMatch = url.pathname.match(/^\/api\/uploads\/([^/]+)$/);
  if (request.method === "GET" && uploadMatch) {
    const id = decodeURIComponent(uploadMatch[1]);
    if (!uploadIdPattern.test(id)) throw new HttpError(400, "Invalid image attachment");
    response.statusCode = 200;
    response.setHeader("Content-Type", mimeTypeForUpload(id));
    response.setHeader("Cache-Control", "private, max-age=86400");
    response.end(await readImageUpload(id));
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/uploads/images") {
    requireSameOrigin(request);
    const mimeType = request.headers["content-type"]?.split(";", 1)[0];
    if (!mimeType?.startsWith("image/")) throw new HttpError(415, "A supported image is required");
    try {
      sendJson(
        response,
        201,
        await saveImageUpload(await readBytes(request, MAX_IMAGE_BYTES), mimeType),
      );
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(400, error instanceof Error ? error.message : "Invalid image");
    }
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/agents") {
    sendJson(response, 200, await service.getDashboard());
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/agents") {
    requireSameOrigin(request);
    const body = createAgentRequestSchema.parse(await readJson(request));
    const agent = await service.createPiAgent(body.workspaceId, body.name, body.tabLabel);
    sendJson(response, 201, { agent });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/workspaces") {
    requireSameOrigin(request);
    const body = createWorkspaceRequestSchema.parse(await readJson(request));
    const workspace = await service.createWorkspace(body.label, body.cwd);
    sendJson(response, 201, { workspace });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/tabs") {
    requireSameOrigin(request);
    const body = createTabRequestSchema.parse(await readJson(request));
    const tab = await service.createTab(body.workspaceId, body.label);
    sendJson(response, 201, { tab });
    return true;
  }

  const tabTarget = getTabTarget(url.pathname);
  if (request.method === "PATCH" && tabTarget) {
    requireSameOrigin(request);
    const body = renameTabRequestSchema.parse(await readJson(request));
    await service.renameTab(tabTarget, body.label);
    sendJson(response, 200, { ok: true });
    return true;
  }
  if (request.method === "DELETE" && tabTarget) {
    requireSameOrigin(request);
    await service.closeTab(tabTarget);
    sendJson(response, 200, { ok: true });
    return true;
  }

  const paneRoute = getPaneRoute(url.pathname);
  if (paneRoute && request.method === "GET" && paneRoute.action === "output") {
    const lines = linesSchema.parse(url.searchParams.get("lines") ?? undefined);
    sendJson(response, 200, await service.readPane(paneRoute.paneId, lines));
    return true;
  }
  if (paneRoute && request.method === "POST" && paneRoute.action === "input") {
    requireSameOrigin(request);
    const body = paneInputRequestSchema.parse(await readJson(request));
    await service.sendPaneInput(paneRoute.paneId, body.text);
    sendJson(response, 200, { ok: true });
    return true;
  }
  if (paneRoute && request.method === "POST" && paneRoute.action === "keys") {
    requireSameOrigin(request);
    const body = keyRequestSchema.parse(await readJson(request));
    await service.sendPaneKey(paneRoute.paneId, body.key);
    sendJson(response, 200, { ok: true });
    return true;
  }

  const route = getAgentRoute(url.pathname);
  if (!route) return false;

  if (request.method === "PATCH" && !route.action) {
    requireSameOrigin(request);
    const body = renameAgentRequestSchema.parse(await readJson(request));
    await service.renameAgent(route.target, body.name);
    sendJson(response, 200, { ok: true });
    return true;
  }

  if (request.method === "GET" && route.action === "chat") {
    if (request.headers.origin) requireSameOrigin(request);
    if (request.headers["sec-fetch-site"] === "cross-site")
      throw new HttpError(403, "Cross-origin request rejected");
    liveEvents(response, await service.getAgent(route.target), bridge);
    return true;
  }

  if (request.method === "GET" && route.action === "output") {
    const lines = linesSchema.parse(url.searchParams.get("lines") ?? undefined);
    sendJson(response, 200, await service.readAgent(route.target, lines));
    return true;
  }

  if (request.method === "POST" && route.action === "restart") {
    requireSameOrigin(request);
    sendJson(response, 200, { agent: await service.restartPiAgent(route.target) });
    return true;
  }

  if (
    request.method === "POST" &&
    ["prompt", "stop", "tree", "tree-navigation"].includes(route.action)
  ) {
    requireSameOrigin(request);
    const raw = await readJson(request);
    let input: Parameters<LiveBridge["request"]>[2];
    let target: z.infer<typeof chatTargetSchema>;
    if (route.action === "prompt") {
      const body = chatCommandSchema.parse(raw);
      target = body.target;
      input = {
        action: "send",
        text: body.text,
        attachments: body.attachments,
        requestId: body.requestId,
      };
    } else {
      const body = treeRequestSchema.parse(raw);
      target = body.target;
      if (route.action === "tree-navigation") {
        if (!body.entryId) throw new HttpError(400, "Entry ID required");
        input = { action: "navigate", entryId: body.entryId };
      } else input = { action: route.action as "tree" | "stop" };
    }
    const reply = await bridge.request(await service.getAgent(route.target), target, input);
    if (reply.type === "ack" && reply.outcome === "rejected")
      sendJson(response, 409, { error: reply.reason });
    else sendJson(response, 200, reply);
    return true;
  }

  if (request.method === "POST" && route.action === "keys") {
    requireSameOrigin(request);
    const body = keyRequestSchema.parse(await readJson(request));
    await service.sendKey(route.target, body.key);
    sendJson(response, 200, { ok: true });
    return true;
  }

  return false;
}

function serveStatic(request: IncomingMessage, response: ServerResponse, publicDir: string) {
  if (request.method !== "GET" && request.method !== "HEAD") return false;

  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  const requestedPath = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
  let filePath = resolve(publicDir, requestedPath);
  if (!filePath.startsWith(`${resolve(publicDir)}${sep}`)) return false;

  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    filePath = resolve(publicDir, "index.html");
  }
  if (!existsSync(filePath)) return false;

  response.statusCode = 200;
  response.setHeader("Content-Type", contentTypes[extname(filePath)] ?? "application/octet-stream");
  if (request.method === "HEAD") response.end();
  else createReadStream(filePath).pipe(response);
  return true;
}

export function createHttpServer(service: HerdrService, publicDir: string, bridge: LiveBridge) {
  return createServer(async (request, response) => {
    setSecurityHeaders(response);

    try {
      const handled = request.url?.startsWith("/api/")
        ? await handleApi(request, response, service, bridge)
        : serveStatic(request, response, publicDir);

      if (!handled) sendJson(response, 404, { error: "Not found" });
    } catch (error) {
      if (error instanceof z.ZodError) {
        sendJson(response, 400, { error: "Invalid request" });
        return;
      }
      if (error instanceof HttpError || error instanceof LiveChatError) {
        sendJson(response, error.status, { error: error.message });
        return;
      }
      if (error instanceof HerdrRequestError) {
        const status = error.code === "unavailable" ? 503 : 502;
        sendJson(response, status, { error: error.message, code: error.code });
        return;
      }

      sendJson(response, 500, { error: "Unexpected server error" });
    }
  });
}
