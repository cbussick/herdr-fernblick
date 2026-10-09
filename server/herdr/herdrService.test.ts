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
    {
      name: "fix-auth",
      kind: "pi",
      pane_id: "w1:p2",
      timeout_ms: 30_000,
      args: ["--extension", expect.stringContaining("pi-live-chat/index")],
    },
    expect.anything(),
  ]);
  expect(createdAgent).toMatchObject({
    agent: "pi",
    name: "fix-auth",
    tab_label: "Authentication",
  });
});

it("isolates development extensions while explicitly retaining Herdr session reporting", async () => {
  vi.stubEnv("FERNBLICK_PI_ISOLATED", "1");
  vi.stubEnv("FERNBLICK_PI_GLOBAL", "1");
  vi.stubEnv("FERNBLICK_HERDR_EXTENSION", "/private/herdr-agent-state.ts");
  try {
    const request = vi.fn(async <T>(method: string, _params: unknown, schema: z.ZodType<T>) =>
      schema.parse(
        method === "tab.create"
          ? {
              type: "tab_created",
              tab: { label: "Demo", tab_id: "w1:t2", workspace_id: "w1" },
              root_pane: { pane_id: "w1:p2", revision: 0 },
            }
          : { type: "agent_started", agent },
      ),
    );
    await new HerdrService({ request } as unknown as HerdrClient).createPiAgent("w1");
    expect(request.mock.calls[1][1]).toMatchObject({
      args: [
        "--no-extensions",
        "--extension",
        expect.stringContaining("pi-live-chat/index"),
        "--extension",
        "/private/herdr-agent-state.ts",
      ],
    });
  } finally {
    vi.unstubAllEnvs();
  }
});

it("generates a valid default agent name while letting Herdr choose the tab name", async () => {
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
    {
      name: "pi-w1-p2",
      kind: "pi",
      pane_id: "w1:p2",
      timeout_ms: 30_000,
      args: ["--extension", expect.stringContaining("pi-live-chat/index")],
    },
    expect.anything(),
  ]);
});

it("gracefully restarts Pi in the same pane and session", async () => {
  const sessionPath = "/root/.pi/agent/sessions/project/session.jsonl";
  const restartableAgent = {
    ...agent,
    agent_session: { agent: "pi", kind: "path", source: "herdr:pi", value: sessionPath },
  };
  const request = vi.fn(async <T>(method: string, _params: unknown, schema: z.ZodType<T>) => {
    if (method === "agent.get")
      return schema.parse({ type: "agent_info", agent: restartableAgent });
    if (method === "session.snapshot") {
      return schema.parse({
        type: "session_snapshot",
        snapshot: { agents: [], panes: [], tabs: [], workspaces: [] },
      });
    }
    if (method === "agent.start") {
      return schema.parse({ type: "agent_started", agent: restartableAgent });
    }
    return schema.parse({ type: "ok" });
  });
  const service = new HerdrService({ request } as unknown as HerdrClient);

  await service.restartPiAgent("fix-auth");

  expect(request).toHaveBeenCalledWith(
    "pane.send_input",
    { pane_id: "w1:p2", text: "/quit", keys: ["enter"] },
    expect.anything(),
  );
  expect(request).toHaveBeenCalledWith(
    "agent.start",
    expect.objectContaining({
      name: "fix-auth",
      pane_id: "w1:p2",
      args: [
        "--session",
        sessionPath,
        "--extension",
        expect.stringContaining("pi-live-chat/index"),
      ],
    }),
    expect.anything(),
  );
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
