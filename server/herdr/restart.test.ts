import { expect, it, vi } from "vitest";
import type { z } from "zod";
import type { EditorTheme, TUI } from "@earendil-works/pi-tui";
import type { HerdrClient } from "./HerdrClient.js";
import { HerdrService } from "./herdrService.js";

const agent = {
  agent: "pi",
  agent_status: "idle",
  focused: false,
  name: "fixture",
  pane_id: "w1:p2",
  revision: 1,
  tab_id: "w1:t2",
  workspace_id: "w1",
  agent_session: { agent: "pi", kind: "path", source: "fixture", value: "/fixture/session.jsonl" },
};
function fixture(input?: (params: { text?: string; keys?: string[] }) => void) {
  const request = vi.fn(async <T>(method: string, params: unknown, schema: z.ZodType<T>) => {
    if (method === "agent.get") return schema.parse({ type: "agent_info", agent });
    if (method === "pane.send_input") input?.(params as { text?: string; keys?: string[] });
    if (method === "session.snapshot")
      return schema.parse({
        type: "session_snapshot",
        snapshot: { agents: [], panes: [], tabs: [], workspaces: [] },
      });
    if (method === "agent.start") return schema.parse({ type: "agent_started", agent });
    return schema.parse({ type: "ok" });
  });
  return { request, service: new HerdrService({ request } as unknown as HerdrClient) };
}
it("never types /quit or submits an existing Pi editor draft during restart", async () => {
  const { Editor } = (await import(
    process.env.PI_EDITOR_TEST_MODULE ?? "@earendil-works/pi-tui"
  )) as typeof import("@earendil-works/pi-tui");
  const identity = (text: string) => text;
  const theme: EditorTheme = {
    borderColor: identity,
    selectList: {
      selectedPrefix: identity,
      selectedText: identity,
      description: identity,
      scrollInfo: identity,
      noMatch: identity,
    },
  };
  const editor = new Editor(
    { requestRender() {}, terminal: { rows: 24, columns: 80 } } as unknown as TUI,
    theme,
  );
  const draft = "An older unsent prompt";
  editor.setText(draft);
  const submitted: string[] = [];
  editor.onSubmit = (text) => submitted.push(text);
  const { service, request } = fixture(({ text, keys }) => {
    if (text) editor.handleInput(`\x1b[200~${text}\x1b[201~`);
    for (const key of keys ?? []) if (key === "enter") editor.handleInput("\r");
  });
  const shutdown = vi.fn(async () => {
    throw new Error("Pi terminal has an unsent draft");
  });
  const result = await service.restartPiAgent("fixture", shutdown).catch((error: Error) => error);
  expect(submitted).toEqual([]);
  expect(editor.getText()).toBe(draft);
  expect(result).toBeInstanceOf(Error);
  expect(shutdown).toHaveBeenCalledOnce();
  expect(request.mock.calls.map(([method]) => method)).toEqual(["agent.get"]);
});
it("waits for shutdown confirmation and excludes simultaneous restarts in one pane", async () => {
  const { service, request } = fixture();
  let confirm!: () => void;
  const shutdown = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        confirm = resolve;
      }),
  );
  const first = service.restartPiAgent("fixture", shutdown);
  await vi.waitFor(() => expect(shutdown).toHaveBeenCalledOnce());
  expect(request.mock.calls.map(([method]) => method)).toEqual(["agent.get"]);
  await expect(service.restartPiAgent("w1:p2", shutdown)).rejects.toThrow("restart");
  confirm();
  await expect(first).resolves.toMatchObject(agent);
  expect(request.mock.calls.filter(([method]) => method === "agent.start")).toHaveLength(1);
  expect(request.mock.calls.some(([method]) => method === "pane.send_input")).toBe(false);
});
it("does not launch or fall back to terminal input after an unconfirmed shutdown", async () => {
  const { service, request } = fixture();
  await expect(
    service.restartPiAgent("fixture", async () => {
      throw new Error("Connection lost");
    }),
  ).rejects.toThrow("Connection lost");
  expect(request.mock.calls.map(([method]) => method)).toEqual(["agent.get"]);
  await expect(service.restartPiAgent("fixture", async () => {})).resolves.toMatchObject(agent);
});
it("does not start a replacement until the old agent actually exits", async () => {
  vi.useFakeTimers();
  try {
    const { service, request } = fixture();
    request.mockImplementation(
      async <T>(method: string, _params: unknown, schema: z.ZodType<T>) => {
        if (method === "agent.get") return schema.parse({ type: "agent_info", agent });
        if (method === "session.snapshot")
          return schema.parse({
            type: "session_snapshot",
            snapshot: { agents: [agent], panes: [], tabs: [], workspaces: [] },
          });
        throw new Error(`Unexpected request: ${method}`);
      },
    );
    const pending = service
      .restartPiAgent("fixture", async () => {})
      .catch((error: Error) => error);
    await vi.advanceTimersByTimeAsync(10_100);
    expect(await pending).toMatchObject({ message: "Pi did not exit in time" });
    expect(
      request.mock.calls.some(
        ([method]) => method === "agent.start" || method === "pane.send_input",
      ),
    ).toBe(false);
  } finally {
    vi.useRealTimers();
  }
});
