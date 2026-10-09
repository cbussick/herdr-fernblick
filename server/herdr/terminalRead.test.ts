import { expect, it, vi } from "vitest";
import type { z } from "zod";
import { HerdrRequestError, type HerdrClient } from "./HerdrClient.js";
import { HerdrService } from "./herdrService.js";

const agent = {
  agent: "pi",
  pane_id: "w21:p9",
  workspace_id: "w21",
  tab_id: "w21:t9",
  focused: false,
  revision: 1,
  agent_status: "working",
};
const output = {
  pane_id: agent.pane_id,
  workspace_id: agent.workspace_id,
  tab_id: agent.tab_id,
  format: "text",
  text: "Agent is working…",
  revision: 1,
  truncated: false,
};
const historyUnavailable =
  "cannot read 600 lines while w21:p9 is working: its alternate-screen history can only be captured by scrolling while idle. Wait and retry, or use --source visible";

function fixture(status: string, shell = false) {
  const request = vi.fn(
    async <T>(method: string, params: Record<string, unknown>, schema: z.ZodType<T>) => {
      const current = { ...agent, agent_status: status };
      if (method === "agent.get") return schema.parse({ type: "agent_info", agent: current });
      if (method === "session.snapshot") {
        return schema.parse({
          type: "session_snapshot",
          snapshot: { agents: shell ? [] : [current], panes: [], tabs: [], workspaces: [] },
        });
      }
      return schema.parse({ type: "pane_read", read: { ...output, source: params.source } });
    },
  );
  return { request, service: new HerdrService({ request } as unknown as HerdrClient) };
}

it("loads history for a done agent using the resolved pane rather than its mutable name", async () => {
  const { request, service } = fixture("done");
  await expect(service.readAgent("agent-name", 600, "recent_unwrapped")).resolves.toMatchObject({
    source: "recent_unwrapped",
  });
  expect(request.mock.calls[0][0]).toBe("agent.get");
  expect(request.mock.calls[1]).toEqual([
    "pane.read",
    {
      pane_id: agent.pane_id,
      source: "recent_unwrapped",
      lines: 600,
      format: "text",
      strip_ansi: true,
    },
    expect.anything(),
  ]);
});

it.each(["blocked", "unknown"])(
  "rejects history reads for a %s agent before attempting to scroll",
  async (status) => {
    const { request, service } = fixture(status);
    await expect(service.readAgent(agent.pane_id, 600, "recent_unwrapped")).rejects.toThrow("idle");
    await expect(service.readPane(agent.pane_id, 600, "recent_unwrapped")).rejects.toThrow("idle");
    expect(request.mock.calls.map(([method]) => method)).toEqual(["agent.get", "session.snapshot"]);
  },
);

it("loads shell history on demand after checking for an agent in the pane", async () => {
  const { request, service } = fixture("idle", true);
  await expect(service.readPane(agent.pane_id, 600, "recent_unwrapped")).resolves.toMatchObject({
    source: "recent_unwrapped",
  });
  expect(request.mock.calls.map(([method]) => method)).toEqual(["session.snapshot", "pane.read"]);
});

it("surfaces a history race instead of silently substituting the visible screen", async () => {
  const { request, service } = fixture("idle");
  const error = new HerdrRequestError("busy", historyUnavailable);
  request
    .mockImplementationOnce(async (_method, _params, schema) =>
      schema.parse({ type: "agent_info", agent: { ...agent, agent_status: "idle" } }),
    )
    .mockRejectedValueOnce(error);
  await expect(service.readAgent(agent.pane_id, 600, "recent_unwrapped")).rejects.toBe(error);
  expect(request).toHaveBeenCalledTimes(2);
});

it("does not retry failed visible reads or attempt history", async () => {
  const request = vi
    .fn()
    .mockRejectedValue(new HerdrRequestError("unavailable", "socket unavailable"));
  const service = new HerdrService({ request } as unknown as HerdrClient);
  await expect(service.readAgent(agent.pane_id, 600)).rejects.toThrow("socket unavailable");
  expect(request).toHaveBeenCalledTimes(1);
});
