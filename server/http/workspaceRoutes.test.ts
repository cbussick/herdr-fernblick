import { mkdtemp, rm } from "node:fs/promises";
import type { Server as HttpServer } from "node:http";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { HerdrClient } from "../herdr/HerdrClient.js";
import { HerdrService } from "../herdr/herdrService.js";
import { LiveBridge } from "../pi/liveBridge.js";
import { createHttpServer } from "./server.js";

let directory: string;
let socketServer: net.Server;
let httpServer: HttpServer;
let base: string;
let rejectMove: boolean;
const requests: { method: string; params: unknown }[] = [];

beforeEach(async () => {
  requests.length = 0;
  rejectMove = false;
  directory = await mkdtemp(join(tmpdir(), "fernblick-reorder-"));
  const socketPath = join(directory, "herdr.sock");
  socketServer = net.createServer((socket) => {
    socket.setEncoding("utf8");
    socket.once("data", (data) => {
      const request = JSON.parse(String(data));
      requests.push({ method: request.method, params: request.params });
      socket.end(
        `${JSON.stringify({
          id: request.id,
          ...(rejectMove
            ? { error: { code: "workspace_not_found", message: "Workspace no longer exists" } }
            : { result: { type: "workspace_list", workspaces: [] } }),
        })}\n`,
      );
    });
  });
  await new Promise<void>((done) => socketServer.listen(socketPath, done));
  httpServer = createHttpServer(
    new HerdrService(new HerdrClient(socketPath)),
    "/unused",
    new LiveBridge(join(directory, "pi.sock"), socketPath),
  );
  await new Promise<void>((done) => httpServer.listen(0, "127.0.0.1", done));
  base = `http://127.0.0.1:${(httpServer.address() as { port: number }).port}`;
});

afterEach(async () => {
  httpServer.closeAllConnections();
  await new Promise<void>((done) => httpServer.close(() => done()));
  await new Promise<void>((done) => socketServer.close(() => done()));
  await rm(directory, { recursive: true, force: true });
});

function move(body: unknown, origin = base) {
  return fetch(`${base}/api/workspaces/move`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify(body),
  });
}

it.each(["w1", null])(
  "moves relative to %s without focusing or recreating workspaces",
  async (beforeWorkspaceId) => {
    const response = await move({ workspaceId: "w3", beforeWorkspaceId });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(requests).toEqual([
      {
        method: "workspace.move_block",
        params: { workspace_ids: ["w3"], before_workspace_id: beforeWorkspaceId },
      },
    ]);
  },
);

it.each([
  {},
  { workspaceId: "w1" },
  { workspaceId: "w1", beforeWorkspaceId: "w1" },
  { workspaceId: "../bad", beforeWorkspaceId: null },
  { workspaceId: "w1", beforeWorkspaceId: 0 },
])("rejects invalid moves before calling Herdr: %j", async (body) => {
  expect((await move(body)).status).toBe(400);
  expect(requests).toEqual([]);
});

it("requires same-origin requests", async () => {
  expect(
    (await move({ workspaceId: "w1", beforeWorkspaceId: null }, "https://evil.invalid")).status,
  ).toBe(403);
  expect(requests).toEqual([]);
});

it("preserves Herdr errors without retrying the move", async () => {
  rejectMove = true;
  const response = await move({ workspaceId: "w1", beforeWorkspaceId: null });
  expect(response.status).toBe(502);
  expect(await response.json()).toEqual({
    error: "Workspace no longer exists",
    code: "workspace_not_found",
  });
  expect(requests).toHaveLength(1);
});
