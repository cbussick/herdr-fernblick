import type { Server } from "node:http";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { z } from "zod";
import type { HerdrClient } from "../herdr/HerdrClient.js";
import { HerdrService } from "../herdr/herdrService.js";
import { LiveBridge } from "../pi/liveBridge.js";
import { createHttpServer } from "./server.js";

let server: Server;
let base: string;
let status: string;
const request = vi.fn();
const agent = {
  agent: "pi",
  pane_id: "w1:p1",
  tab_id: "w1:t1",
  workspace_id: "w1",
  focused: false,
  revision: 1,
};
beforeEach(async () => {
  status = "working";
  request
    .mockReset()
    .mockImplementation(
      async <T>(method: string, params: Record<string, unknown>, schema: z.ZodType<T>) => {
        const current = { ...agent, agent_status: status };
        if (method === "agent.get") return schema.parse({ type: "agent_info", agent: current });
        if (method === "session.snapshot")
          return schema.parse({
            type: "session_snapshot",
            snapshot: { agents: [current], panes: [], tabs: [], workspaces: [] },
          });
        return schema.parse({
          type: "pane_read",
          read: {
            ...agent,
            source: params.source,
            format: "text",
            text: "Screen",
            truncated: false,
          },
        });
      },
    );
  server = createHttpServer(
    new HerdrService({ request } as unknown as HerdrClient),
    "/unused",
    new LiveBridge("/unused/pi.sock", "/unused/herdr.sock"),
  );
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterEach(async () => {
  server.closeAllConnections();
  await new Promise<void>((done, reject) =>
    server.close((error) => (error ? reject(error) : done())),
  );
});

it.each(["agents", "panes"])(
  "defaults %s output to the visible screen while working",
  async (kind) => {
    const response = await fetch(`${base}/api/${kind}/w1%3Ap1/output?lines=600`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ source: "visible", text: "Screen" });
    expect(request).toHaveBeenCalledOnce();
    expect(request.mock.calls[0][1]).not.toHaveProperty("lines");
  },
);

it.each(["agents", "panes"])("allows explicit %s history only while idle", async (kind) => {
  const url = `${base}/api/${kind}/w1%3Ap1/output?source=recent_unwrapped&lines=600`;
  const refused = await fetch(url);
  expect(refused.status).toBe(409);
  expect(await refused.json()).toMatchObject({ error: "Load history when the agent is idle." });
  expect(request).toHaveBeenCalledOnce();
  status = "idle";
  const response = await fetch(url);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ source: "recent_unwrapped" });
  expect(request.mock.calls.at(-1)![1]).toMatchObject({ source: "recent_unwrapped", lines: 600 });
});

it.each(["agents", "panes"])("rejects unsupported %s output sources", async (kind) => {
  const response = await fetch(`${base}/api/${kind}/w1%3Ap1/output?source=scroll_everything`);
  expect(response.status).toBe(400);
  expect(request).not.toHaveBeenCalled();
});
