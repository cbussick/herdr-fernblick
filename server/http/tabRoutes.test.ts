import { mkdtemp, rm } from "node:fs/promises";
import type { Server as HttpServer } from "node:http";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { HerdrClient } from "../herdr/HerdrClient.js";
import { HerdrService } from "../herdr/herdrService.js";
import { createHttpServer } from "./server.js";
import { LiveBridge } from "../pi/liveBridge.js";

let directory: string;
let socketServer: net.Server;
let httpServer: HttpServer;
let base: string;
let label: string;
let rejectRename: boolean;
const requests: { method: string; params: Record<string, unknown> }[] = [];

beforeEach(async () => {
  label = "Original tab";
  rejectRename = false;
  requests.length = 0;
  directory = await mkdtemp(join(tmpdir(), "fernblick-rename-"));
  const socketPath = join(directory, "herdr.sock");
  socketServer = net.createServer((socket) => {
    socket.setEncoding("utf8");
    socket.once("data", (data) => {
      const request = JSON.parse(String(data).trim()) as {
        id: string;
        method: string;
        params: Record<string, unknown>;
      };
      requests.push({ method: request.method, params: request.params });
      if (rejectRename) {
        socket.end(
          `${JSON.stringify({ id: request.id, error: { code: "tab_not_found", message: "Tab not found" } })}\n`,
        );
        return;
      }
      label = String(request.params.label);
      // Captured from Herdr 0.9.0: tab.rename applies the label and returns tab_info.
      const result = { type: "tab_info", tab: { label, tab_id: "w1:t1", workspace_id: "w1" } };
      socket.end(`${JSON.stringify({ id: request.id, result })}\n`);
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

function rename() {
  return fetch(`${base}/api/tabs/w1%3At1`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Origin: base },
    body: JSON.stringify({ label: "Renamed tab" }),
  });
}

it("acknowledges the first tab rename instead of failing after applying it", async () => {
  const response = await rename();
  expect(label).toBe("Renamed tab");
  expect(await response.json()).toEqual({ ok: true });
  expect(response.status).toBe(200);
  expect(requests).toEqual([
    { method: "tab.rename", params: { tab_id: "w1:t1", label: "Renamed tab" } },
  ]);
});

it("preserves real Herdr rename errors", async () => {
  rejectRename = true;
  const response = await rename();
  expect(response.status).toBe(502);
  expect(await response.json()).toEqual({ error: "Tab not found", code: "tab_not_found" });
  expect(label).toBe("Original tab");
});
