import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WorkspaceList } from "./AgentOverview";
import type { Agent, ShellTab } from "../../shared/api/contracts";

let renderer: ReactTestRenderer;
let client: QueryClient;
const onCreateAgent = vi.fn();
const summary = () => renderer.root.findAllByType("summary")[1]!;

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  onCreateAgent.mockClear();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    renderer = create(workspaceList([], []));
  });
});

afterEach(async () => {
  await act(async () => renderer.unmount());
  client.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const shell: ShellTab = {
  tab_id: "w2:t1",
  pane_id: "w2:p1",
  workspace_id: "w2",
  label: "Terminal",
  revision: 1,
};
const agent: Agent = {
  agent: "pi",
  agent_status: "idle",
  focused: false,
  pane_id: "w2:p2",
  tab_id: "w2:t2",
  workspace_id: "w2",
  revision: 1,
};

function workspaceList(agents: Agent[], tabs: ShellTab[]) {
  return (
    <QueryClientProvider client={client}>
      <WorkspaceList
        agents={agents}
        tabs={tabs}
        workspaces={[
          { workspace_id: "w1", label: "First" },
          { workspace_id: "w2", label: "Empty workspace" },
        ]}
        selectedPaneId={null}
        onSelectAgent={vi.fn()}
        onSelectTab={vi.fn()}
        onCreateAgent={onCreateAgent}
        query=""
      />
    </QueryClientProvider>
  );
}

async function updateWorkspace(agents: Agent[], tabs: ShellTab[]) {
  await act(async () => {
    renderer.update(workspaceList(agents, tabs));
  });
}

it.each([
  ["empty", []],
  ["shell-only", [shell]],
])("omits the status indicator for a workspace that is %s", async (_, tabs) => {
  await updateWorkspace([], tabs);
  expect(summary().findAllByProps({ "data-ui": "status-indicator" })).toHaveLength(0);
  expect(summary().findByType("small").children.join("")).toBe(
    tabs.length ? "0 agents / 1 shell" : "0 agents",
  );
});

it.each([
  ["idle", "Idle"],
  ["working", "Working"],
  ["blocked", "Needs input"],
  ["done", "New answer"],
  ["unknown", "Unknown"],
] as const)("keeps %s status until the last agent leaves", async (agent_status, label) => {
  await updateWorkspace([{ ...agent, agent_status }], [shell]);
  expect(summary().findByProps({ "data-ui": "status-indicator" }).children).toContain(label);
  await updateWorkspace([], [shell]);
  expect(summary().findAllByProps({ "data-ui": "status-indicator" })).toHaveLength(0);
});

it.each([
  ["First", "w1"],
  ["Empty workspace", "w2"],
])("keeps the plus button for %s without toggling disclosure", (label, workspaceId) => {
  const button = renderer.root.findByProps({ "aria-label": `Create agent in ${label}` });
  const event = { preventDefault: vi.fn(), stopPropagation: vi.fn() };
  button.props.onClick(event);
  expect(onCreateAgent).toHaveBeenCalledExactlyOnceWith(workspaceId);
  expect(event.preventDefault).toHaveBeenCalled();
  expect(event.stopPropagation).toHaveBeenCalled();
});

it.each(["touch", "pen"])(
  "does not create an agent when holding a workspace with %s",
  (pointerType) => {
    const header = summary();
    header.props.onPointerDown?.({
      pointerType,
      button: 0,
      isPrimary: true,
      clientX: 20,
      clientY: 20,
    });
    vi.advanceTimersByTime(2_000);
    header.props.onPointerUp?.();
    expect(onCreateAgent).not.toHaveBeenCalled();
    expect(header.props.onPointerDown).toBeUndefined();
  },
);

it("leaves workspace clicks, keyboard activation and context menus to the browser", () => {
  const header = summary();
  expect(header.props.onClick).toBeUndefined();
  expect(header.props.onKeyDown).toBeUndefined();
  expect(header.props.onContextMenu).toBeUndefined();
});
