import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FlatAgentList, WorkspaceList } from "./AgentOverview";
import { PaneContextActions } from "./PaneContextActions";
import type { Agent, ShellTab } from "../../shared/api/contracts";

let renderer: ReactTestRenderer;
let client: QueryClient;
const onCreateAgent = vi.fn();
const onSelectAgent = vi.fn();
const onSelectTab = vi.fn();
const summary = () => renderer.root.findAllByType("summary")[1]!;

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  onCreateAgent.mockClear();
  onSelectAgent.mockClear();
  onSelectTab.mockClear();
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

function workspaceList(
  agents: Agent[],
  tabs: ShellTab[],
  query = "",
  selectedPaneId: string | null = null,
) {
  return (
    <QueryClientProvider client={client}>
      <WorkspaceList
        agents={agents}
        tabs={tabs}
        workspaces={[
          { workspace_id: "w1", label: "First" },
          { workspace_id: "w2", label: "Empty workspace" },
        ]}
        selectedPaneId={selectedPaneId}
        onSelectAgent={onSelectAgent}
        onSelectTab={onSelectTab}
        onCreateAgent={onCreateAgent}
        query={query}
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
    tabs.length ? "1 shell" : "0 agents",
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

const namedAgents: Agent[] = [
  { ...agent, name: "planner", tab_label: "Orchestrator overhaul" },
  { ...agent, name: "backend", pane_id: "w2:p3", tab_label: "Orchestrator overhaul" },
];
const paneRows = () => renderer.root.findAllByProps({ "data-testid": "pane-row" });
const tabGroups = () => renderer.root.findAllByProps({ "data-testid": "tab-group" });

it("shows one tab heading and distinct agent names, with pane-specific navigation and selection", async () => {
  await act(async () => {
    renderer.update(workspaceList(namedAgents, [], "", "w2:p3"));
  });
  expect(tabGroups()).toHaveLength(1);
  expect(tabGroups()[0]!.type).toBe("details");
  expect(tabGroups()[0]!.findByType("summary").findByType("strong").children).toEqual([
    "Orchestrator overhaul",
  ]);
  expect(tabGroups()[0]!.findByType("small").children.join("")).toBe("Tab");
  expect(paneRows().map((row) => row.findByType("strong").children.join(""))).toEqual([
    "planner",
    "backend",
  ]);
  expect(paneRows()[0]!.props["aria-current"]).toBeUndefined();
  expect(paneRows()[1]!.props["aria-current"]).toBe("page");
  paneRows()[1]!.props.onClick();
  expect(onSelectAgent).toHaveBeenCalledExactlyOnceWith(namedAgents[1]);
  expect(summary().findByType("small").children.join("")).toBe("2 agents");
});

it("gives a single-agent tab the same heading, identity and collapse control", async () => {
  await updateWorkspace([namedAgents[0]!], []);
  expect(tabGroups()[0]!.type).toBe("details");
  expect(tabGroups()[0]!.props["data-split"]).toBe(false);
  expect(tabGroups()[0]!.props["aria-label"]).toBe("Orchestrator overhaul");
  expect(tabGroups()[0]!.findAllByType("summary")).toHaveLength(1);
  expect(
    tabGroups()[0]!
      .findAllByType("strong")
      .map((node) => node.children.join("")),
  ).toEqual(["Orchestrator overhaul", "planner"]);
  expect(tabGroups()[0]!.findByType("small").children).toEqual(["Tab"]);
  expect(tabGroups()[0]!.findByType("summary").findAllByType("svg")).toHaveLength(1);
  expect(paneRows()[0]!.findAllByType("small")).toHaveLength(0);
  paneRows()[0]!.props.onClick();
  expect(onSelectAgent).toHaveBeenCalledExactlyOnceWith(namedAgents[0]);
});

it("gives a single shell the same collapsible heading and an indented terminal row", async () => {
  await updateWorkspace([], [shell]);
  expect(tabGroups()[0]!.type).toBe("details");
  expect(tabGroups()[0]!.props["data-split"]).toBe(false);
  expect(tabGroups()[0]!.findAllByType("summary")).toHaveLength(1);
  expect(
    tabGroups()[0]!
      .findAllByType("strong")
      .map((node) => node.children.join("")),
  ).toEqual(["Terminal", "Shell terminal"]);
  expect(tabGroups()[0]!.findByType("small").children).toEqual(["Tab"]);
  expect(paneRows()[0]!.findAllByType("small")).toHaveLength(0);
  paneRows()[0]!.props.onClick();
  expect(onSelectTab).toHaveBeenCalledExactlyOnceWith(shell);
});

it.each(["agent", "shell"])(
  "keeps a single-%s tab collapsed across polling and temporary search",
  async (kind) => {
    const agents = kind === "agent" ? [namedAgents[0]!] : [];
    const shells = kind === "shell" ? [shell] : [];
    await updateWorkspace(agents, shells);
    expect(tabGroups()[0]!.props.open).toBe(true);
    await act(async () => tabGroups()[0]!.props.onToggle({ currentTarget: { open: false } }));
    await updateWorkspace(agents, shells);
    expect(tabGroups()[0]!.props.open).toBe(false);
    await act(async () => renderer.update(workspaceList(agents, shells, "Empty workspace")));
    expect(tabGroups()[0]!.props.open).toBe(true);
    await updateWorkspace(agents, shells);
    expect(tabGroups()[0]!.props.open).toBe(false);
    await act(async () => tabGroups()[0]!.props.onToggle({ currentTarget: { open: true } }));
    expect(tabGroups()[0]!.props.open).toBe(true);
  },
);

it.each([
  [null, "Agent w2:p2"],
  ["pi-w2-p2", "Agent w2:p2"],
  ["Orchestrator overhaul", "Orchestrator overhaul"],
])(
  "keeps the pane identity separate from the tab when the agent name is %s",
  async (name, title) => {
    await updateWorkspace([{ ...namedAgents[0]!, name }], []);
    expect(paneRows()[0]!.findAllByType("small")).toHaveLength(0);
    expect(paneRows()[0]!.findByType("strong").children).toEqual([title]);
    expect(tabGroups()[0]!.props["aria-label"]).toBe("Orchestrator overhaul");
  },
);

it("keeps headings and names stable when panes join or leave, including during search", async () => {
  await updateWorkspace([namedAgents[0]!], []);
  expect(tabGroups()[0]!.props["data-split"]).toBe(false);
  expect(paneRows()[0]!.findByType("strong").children).toEqual(["planner"]);
  await updateWorkspace(namedAgents, []);
  expect(tabGroups()[0]!.props["data-split"]).toBe(true);
  expect(tabGroups()[0]!.findAllByType("summary")).toHaveLength(1);
  await act(async () => renderer.update(workspaceList(namedAgents, [], "backend")));
  expect(paneRows()).toHaveLength(1);
  expect(tabGroups()[0]!.props["data-split"]).toBe(true);
  await updateWorkspace([namedAgents[1]!], []);
  expect(tabGroups()[0]!.props["data-split"]).toBe(false);
  expect(tabGroups()[0]!.findByType("small").children).toEqual(["Tab"]);
  expect(paneRows()[0]!.findByType("strong").children).toEqual(["backend"]);
});

it("keeps agent rename targets separate from tab labels", async () => {
  await updateWorkspace(namedAgents, []);
  const actions = renderer.root.findAllByType(PaneContextActions);
  expect(actions.map((action) => action.props.label)).toEqual([
    "Orchestrator overhaul",
    "Orchestrator overhaul",
  ]);
  expect(actions.map((action) => action.props.agentTarget)).toEqual(["planner", "backend"]);
  expect(actions.map((action) => action.props.tabId)).toEqual([agent.tab_id, agent.tab_id]);
});

it("groups mixed panes by tab and preserves every split shell's navigation", async () => {
  const mixedShell = { ...shell, tab_id: agent.tab_id, label: "Orchestrator overhaul" };
  const splitShell = { ...mixedShell, pane_id: "w2:p4" };
  await updateWorkspace(namedAgents, [mixedShell, splitShell]);
  expect(tabGroups()).toHaveLength(1);
  expect(tabGroups()[0]!.findByType("small").children.join("")).toBe("Tab");
  expect(paneRows()).toHaveLength(4);
  expect(paneRows()[2]!.findByType("strong").children).toEqual(["Shell w2:p1"]);
  expect(paneRows()[3]!.findByType("strong").children).toEqual(["Shell w2:p4"]);
  paneRows()[3]!.props.onClick();
  expect(onSelectTab).toHaveBeenCalledExactlyOnceWith(splitShell);
});

it.each([
  ["planner", ["planner"], 1],
  ["Orchestrator", ["planner", "backend"], 1],
  ["Empty workspace", ["planner", "backend"], 1],
  ["missing", [], 0],
] as const)("searches %s while preserving tab context", async (query, names, count) => {
  await act(async () => renderer.update(workspaceList(namedAgents, [], query)));
  expect(tabGroups()).toHaveLength(count);
  expect(paneRows().map((row) => row.findByType("strong").children.join(""))).toEqual(names);
  if (count) {
    expect(tabGroups()[0]!.props.open).toBe(true);
    expect(tabGroups()[0]!.props["aria-label"]).toBe("Orchestrator overhaul");
  }
});

it("keeps fallback identities stable when agents are reordered or the tab is renamed", async () => {
  const unnamed = namedAgents.map((item) => ({ ...item, name: null }));
  await updateWorkspace(unnamed, []);
  expect(paneRows().map((row) => row.findByType("strong").children.join(""))).toEqual([
    "Agent w2:p2",
    "Agent w2:p3",
  ]);
  await updateWorkspace(
    unnamed.toReversed().map((item) => ({ ...item, tab_label: "New title" })),
    [],
  );
  expect(paneRows().map((row) => row.findByType("strong").children.join(""))).toEqual([
    "Agent w2:p3",
    "Agent w2:p2",
  ]);
});

it("keeps separate workspaces and tabs even when their titles match", async () => {
  const first = { ...namedAgents[0]!, workspace_id: "w1", tab_id: "w1:t1", pane_id: "w1:p1" };
  await updateWorkspace([first, ...namedAgents], []);
  const workspaces = renderer.root.findAllByProps({ "data-testid": "workspace-disclosure" });
  expect(
    workspaces.map((workspace) => workspace.findAllByProps({ "data-testid": "tab-group" }).length),
  ).toEqual([1, 1]);
  expect(workspaces[0]!.findAllByProps({ "data-testid": "pane-row" })).toHaveLength(1);
  expect(workspaces[1]!.findAllByProps({ "data-testid": "pane-row" })).toHaveLength(2);
});

it("preserves workspace/tab expansion across polling and a temporary search", async () => {
  await updateWorkspace(namedAgents, []);
  const workspace = () =>
    renderer.root.findAllByProps({ "data-testid": "workspace-disclosure" }).at(-1)!;
  await act(async () => workspace().props.onToggle({ currentTarget: { open: true } }));
  await act(async () => tabGroups()[0]!.props.onToggle({ currentTarget: { open: false } }));
  await updateWorkspace(
    namedAgents.map((item) => ({ ...item, revision: 2 })),
    [],
  );
  expect(workspace().props.open).toBe(true);
  expect(tabGroups()[0]!.props.open).toBe(false);
  await act(async () => renderer.update(workspaceList(namedAgents, [], "backend")));
  expect(workspace().props.open).toBe(true);
  expect(tabGroups()[0]!.props.open).toBe(true);
  await act(async () => renderer.update(workspaceList(namedAgents, [])));
  expect(workspace().props.open).toBe(true);
  expect(tabGroups()[0]!.props.open).toBe(false);
});

it("uses distinct names in the flat view and keeps workspace and tab context", async () => {
  await act(async () => {
    renderer.update(
      <QueryClientProvider client={client}>
        <FlatAgentList
          agents={namedAgents}
          selectedPaneId={null}
          onSelect={onSelectAgent}
          query="backend"
        />
      </QueryClientProvider>,
    );
  });
  expect(paneRows()).toHaveLength(1);
  expect(paneRows()[0]!.findByType("strong").children).toEqual(["backend"]);
  expect(paneRows()[0]!.findByType("small").children).toEqual(["w2 · Tab: Orchestrator overhaul"]);
});
