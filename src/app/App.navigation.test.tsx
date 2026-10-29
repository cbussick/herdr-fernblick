import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { App } from "./App";
import { getAgents } from "../shared/api/apiClient";
import type { Agent } from "../shared/api/contracts";

vi.mock("../shared/api/apiClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../shared/api/apiClient")>()),
  getAgents: vi.fn(),
}));
vi.mock("./useSinglePaneLayout", () => ({ useSinglePaneLayout: () => true }));
vi.mock("../features/agents/AgentConsole", () => ({
  AgentConsole: ({ onBack }: { onBack: () => void }) => (
    <main data-testid="chat">
      <button onClick={onBack}>Back to overview</button>
    </main>
  ),
}));

vi.mock("../features/agents/ShellConsole", () => ({
  ShellConsole: () => <main data-testid="shell">Shell</main>,
}));

const agent: Agent = {
  agent: "pi",
  agent_status: "idle",
  focused: false,
  pane_id: "w1:p1",
  tab_id: "w1:t1",
  workspace_id: "w1",
  revision: 1,
};
let renderer: ReactTestRenderer;
let client: QueryClient;
let browser: EventTarget;
let entries: unknown[];
let index: number;
const row = (position = 0) => renderer.root.findAllByProps({ "data-testid": "pane-row" })[position];
const chat = () => renderer.root.findAllByProps({ "data-testid": "chat" });
async function traverse(delta: number) {
  await act(async () => {
    const next = index + delta;
    if (next < 0 || next >= entries.length) return;
    index = next;
    browser.dispatchEvent(Object.assign(new Event("popstate"), { state: entries[index] }));
  });
}
async function open(position = 0) {
  await act(async () => row(position).props.onClick());
  expect(chat()).toHaveLength(1);
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  // The first entry is another website; the second is Fernblick's overview.
  entries = [{ external: true }, null];
  index = 1;
  browser = new EventTarget();
  Object.assign(browser, {
    history: {
      get state() {
        return entries[index];
      },
      pushState(state: unknown) {
        entries.splice(index + 1, Infinity, state);
        index++;
      },
      replaceState(state: unknown) {
        entries[index] = state;
      },
      back: () => traverse(-1),
    },
  });
  vi.stubGlobal("window", browser);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  const response = {
    agents: [agent, { ...agent, pane_id: "w1:p2", tab_id: "w1:t2" }],
    tabs: [],
    workspaces: [{ workspace_id: "w1", label: "Project" }],
  };
  client.setQueryData(["agents"], response);
  vi.mocked(getAgents).mockResolvedValue(response);
  await act(async () => {
    renderer = create(
      <QueryClientProvider client={client}>
        <App />
      </QueryClientProvider>,
    );
  });
});
afterEach(async () => {
  await act(async () => renderer.unmount());
  client.clear();
  vi.unstubAllGlobals();
});

it("returns to the workspaces overview instead of leaving the page on browser Back", async () => {
  await open();
  await traverse(-1);
  expect(index).toBe(1);
  expect(chat()).toHaveLength(0);
  expect(renderer.root.findByProps({ "aria-label": "Search workspaces" })).toBeDefined();
  expect(
    renderer.root.findByProps({ "data-single-pane": true }).props["data-detail-open"],
  ).toBeUndefined();
});

it("keeps the same pane selected as a shell when its agent exits", async () => {
  await open();
  await act(async () => {
    client.setQueryData(["agents"], {
      agents: [],
      tabs: [
        {
          label: "My agent",
          pane_id: agent.pane_id,
          tab_id: agent.tab_id,
          workspace_id: agent.workspace_id,
          revision: 2,
        },
      ],
      workspaces: [{ workspace_id: "w1", label: "Project" }],
    });
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  expect(chat()).toHaveLength(0);
  expect(renderer.root.findByProps({ "data-testid": "shell" })).toBeDefined();
  expect(index).toBe(2);
});

it("restores the selected chat on browser Forward", async () => {
  await open();
  await traverse(-1);
  await traverse(1);
  expect(chat()).toHaveLength(1);
});

it("returns directly to the overview after switching agents", async () => {
  await open();
  await open(1);
  await traverse(-1);
  expect(index).toBe(1);
  expect(chat()).toHaveLength(0);
});

it("uses the same history entry for the in-app Back button", async () => {
  await open();
  await act(async () => {
    await renderer.root.findByProps({ "data-testid": "chat" }).findByType("button").props.onClick();
  });
  expect(index).toBe(1);
  expect(chat()).toHaveLength(0);
  await traverse(1);
  expect(chat()).toHaveLength(1);
});

it("does not trap browser Back on the overview", async () => {
  await traverse(-1);
  expect(index).toBe(0);
});
