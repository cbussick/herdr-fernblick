import { expect, it, vi } from "vitest";
import type { z } from "zod";
import type { HerdrClient } from "./HerdrClient.js";
import { HerdrService } from "./herdrService.js";

const agent = {
  agent: "pi",
  agent_status: "idle",
  focused: false,
  name: "fix-auth",
  pane_id: "w1:p2",
  revision: 1,
  tab_id: "w1:t2",
  workspace_id: "w1",
};

it("uses the raw protocol spelling for recent unwrapped output", async () => {
  const request = vi.fn(
    async <T>(_method: string, params: Record<string, unknown>, schema: z.ZodType<T>) =>
      schema.parse({
        type: "pane_read",
        read: {
          pane_id: "w1:p1",
          workspace_id: "w1",
          tab_id: "w1:t1",
          source: params.source,
          format: "text",
          text: "output",
          revision: 1,
          truncated: false,
        },
      }),
  );
  const service = new HerdrService({ request } as unknown as HerdrClient);

  await service.readAgent("w1:p1", 100);

  expect(request).toHaveBeenCalledWith(
    "agent.read",
    expect.objectContaining({ source: "recent_unwrapped" }),
    expect.anything(),
  );
});

it("adds workspace and tab labels to agents from the session snapshot", async () => {
  const request = vi.fn(async <T>(_method: string, _params: unknown, schema: z.ZodType<T>) =>
    schema.parse({
      type: "session_snapshot",
      snapshot: {
        agents: [agent],
        panes: [
          { pane_id: "w1:p2", revision: 1, tab_id: "w1:t2", workspace_id: "w1" },
          { pane_id: "w1:p3", revision: 2, tab_id: "w1:t3", workspace_id: "w1" },
        ],
        tabs: [
          { label: "Authentication", tab_id: "w1:t2", workspace_id: "w1" },
          { label: "Server logs", tab_id: "w1:t3", workspace_id: "w1" },
        ],
        workspaces: [{ label: "Web app", workspace_id: "w1" }],
      },
    }),
  );
  const service = new HerdrService({ request } as unknown as HerdrClient);

  const dashboard = await service.getDashboard();

  expect(dashboard.agents[0]).toMatchObject({
    tab_label: "Authentication",
    workspace_label: "Web app",
  });
  expect(dashboard.tabs).toEqual([
    {
      label: "Server logs",
      pane_id: "w1:p3",
      revision: 2,
      tab_id: "w1:t3",
      workspace_id: "w1",
      workspace_label: "Web app",
    },
  ]);
  expect(request).toHaveBeenCalledWith("session.snapshot", {}, expect.anything());
});

it("creates a tab before starting Pi in its root pane", async () => {
  const request = vi.fn(async <T>(method: string, _params: unknown, schema: z.ZodType<T>) => {
    if (method === "tab.create") {
      return schema.parse({
        type: "tab_created",
        tab: { label: "Authentication", tab_id: "w1:t2", workspace_id: "w1" },
        root_pane: { pane_id: "w1:p2", revision: 0 },
      });
    }

    return schema.parse({ type: "agent_started", agent });
  });
  const service = new HerdrService({ request } as unknown as HerdrClient);

  const createdAgent = await service.createPiAgent("w1", "fix-auth", "Authentication");

  expect(request.mock.calls[0]).toEqual([
    "tab.create",
    { workspace_id: "w1", label: "Authentication", focus: false },
    expect.anything(),
  ]);
  expect(request.mock.calls[1]).toEqual([
    "agent.start",
    { name: "fix-auth", kind: "pi", pane_id: "w1:p2", timeout_ms: 30_000 },
    expect.anything(),
  ]);
  expect(createdAgent).toMatchObject({ name: "fix-auth", tab_label: "Authentication" });
});

it("lets Herdr choose default agent and tab names", async () => {
  const request = vi.fn(async <T>(method: string, _params: unknown, schema: z.ZodType<T>) => {
    if (method === "tab.create") {
      return schema.parse({
        type: "tab_created",
        tab: { label: "2", tab_id: "w1:t2", workspace_id: "w1" },
        root_pane: { pane_id: "w1:p2", revision: 0 },
      });
    }

    return schema.parse({ type: "agent_started", agent: { ...agent, name: "pi" } });
  });
  const service = new HerdrService({ request } as unknown as HerdrClient);

  await service.createPiAgent("w1");

  expect(request.mock.calls[0]).toEqual([
    "tab.create",
    { workspace_id: "w1", focus: false },
    expect.anything(),
  ]);
  expect(request.mock.calls[1]).toEqual([
    "agent.start",
    { kind: "pi", pane_id: "w1:p2", timeout_ms: 30_000 },
    expect.anything(),
  ]);
});

it("creates an unfocused workspace in the requested directory", async () => {
  const request = vi.fn(async <T>(_method: string, _params: unknown, schema: z.ZodType<T>) =>
    schema.parse({
      type: "workspace_created",
      workspace: { label: "API", workspace_id: "w2" },
    }),
  );
  const service = new HerdrService({ request } as unknown as HerdrClient);

  const workspace = await service.createWorkspace("API", "/srv/api");

  expect(request).toHaveBeenCalledWith(
    "workspace.create",
    { label: "API", cwd: "/srv/api", focus: false },
    expect.anything(),
  );
  expect(workspace).toEqual({ label: "API", workspace_id: "w2" });
});

it("creates a shell tab and sends commands to its pane", async () => {
  const request = vi.fn(async <T>(method: string, _params: unknown, schema: z.ZodType<T>) => {
    if (method === "tab.create") {
      return schema.parse({
        type: "tab_created",
        tab: { label: "Logs", tab_id: "w1:t3", workspace_id: "w1" },
        root_pane: { pane_id: "w1:p3", revision: 0 },
      });
    }
    return schema.parse({ type: "ok" });
  });
  const service = new HerdrService({ request } as unknown as HerdrClient);

  const tab = await service.createTab("w1", "Logs");
  await service.sendPaneInput(tab.pane_id, "tail -f app.log");

  expect(tab).toMatchObject({ label: "Logs", pane_id: "w1:p3" });
  expect(request.mock.calls[1]).toEqual([
    "pane.send_input",
    { pane_id: "w1:p3", text: "tail -f app.log", keys: ["enter"] },
    expect.anything(),
  ]);
});

it("closes the underlying Herdr tab", async () => {
  const request = vi.fn(async <T>(_method: string, _params: unknown, schema: z.ZodType<T>) =>
    schema.parse({ type: "ok" }),
  );
  const service = new HerdrService({ request } as unknown as HerdrClient);

  await service.closeTab("w1:t3");

  expect(request).toHaveBeenCalledWith("tab.close", { tab_id: "w1:t3" }, expect.anything());
});
