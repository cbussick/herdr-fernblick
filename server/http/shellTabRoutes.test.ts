import { mkdtemp, rm } from "node:fs/promises";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { z } from "zod";
import type { HerdrClient } from "../herdr/HerdrClient.js";
import { HerdrService } from "../herdr/herdrService.js";
import { LiveBridge } from "../pi/liveBridge.js";
import { createHttpServer } from "./server.js";

let directory: string;
let server: Server;
let base: string;
const request = vi.fn();
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "fernblick-shell-tabs-"));
  request.mockReset();
  request.mockImplementation(
    async <T>(method: string, params: { label?: string }, schema: z.ZodType<T>) => {
      expect(method).toBe("tab.create");
      return schema.parse({
        type: "tab_created",
        tab: { tab_id: "w1:t3", workspace_id: "w1", label: params.label ?? "3" },
        root_pane: { pane_id: "w1:p3", revision: 0 },
      });
    },
  );
  server = createHttpServer(
    new HerdrService({ request } as unknown as HerdrClient),
    "/unused",
    new LiveBridge(join(directory, "pi.sock"), join(directory, "herdr.sock")),
  );
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterEach(async () => {
  server.closeAllConnections();
  await new Promise<void>((done) => server.close(() => done()));
  await rm(directory, { recursive: true, force: true });
});
const createTab = (body: unknown) =>
  fetch(`${base}/api/tabs`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: base },
    body: JSON.stringify(body),
  });

it.each([undefined, "", "   "])(
  "lets Herdr number a shell tab when its label is %j",
  async (label) => {
    const response = await createTab({ workspaceId: "w1", label });
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      tab: {
        label: "3",
        pane_id: "w1:p3",
        revision: 0,
        tab_id: "w1:t3",
        workspace_id: "w1",
      },
    });
    expect(request).toHaveBeenCalledExactlyOnceWith(
      "tab.create",
      { workspace_id: "w1", focus: false },
      expect.anything(),
    );
  },
);

it("still supports an explicit trimmed shell tab name", async () => {
  const response = await createTab({ workspaceId: "w1", label: " Server logs " });
  expect(response.status).toBe(201);
  expect(await response.json()).toMatchObject({ tab: { label: "Server logs" } });
  expect(request).toHaveBeenCalledExactlyOnceWith(
    "tab.create",
    { workspace_id: "w1", label: "Server logs", focus: false },
    expect.anything(),
  );
});

it.each([
  { workspaceId: "w1", label: "x".repeat(81) },
  { workspaceId: "w1", label: null },
  { workspaceId: "invalid workspace" },
  {},
])("rejects invalid input without creating a shell: %j", async (body) => {
  expect((await createTab(body)).status).toBe(400);
  expect(request).not.toHaveBeenCalled();
});
