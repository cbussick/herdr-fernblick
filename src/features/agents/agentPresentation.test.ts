import { expect, it } from "vitest";
import type { Agent, ShellTab } from "../../shared/api/contracts";
import { getAgentLabel, groupAgentsByWorkspace, groupPanesByTab } from "./agentPresentation";

const agent: Agent = {
  name: "planner",
  pane_id: "w1:p1",
  tab_id: "w1:t1",
  tab_label: "Orchestrator overhaul",
  workspace_id: "w1",
  agent_status: "idle",
  focused: false,
  revision: 1,
};
const shell: ShellTab = {
  label: "Orchestrator overhaul",
  pane_id: "w1:p3",
  tab_id: "w1:t1",
  workspace_id: "w1",
  workspace_label: "Project",
  revision: 1,
};

it("uses the real agent name rather than the shared tab title", () => {
  expect(getAgentLabel(agent)).toBe("planner");
  expect(getAgentLabel({ ...agent, name: "backend", pane_id: "w1:p2" })).toBe("backend");
});

it("keeps unnamed agent identities distinct and stable when titles change", () => {
  const unnamed = { ...agent, name: null, title: "Shared title" };
  expect(getAgentLabel(unnamed)).toBe("Agent w1:p1");
  expect(getAgentLabel({ ...unnamed, title: "Another title", tab_label: "Renamed" })).toBe(
    "Agent w1:p1",
  );
  expect(getAgentLabel({ ...unnamed, name: " ", pane_id: "w1:p2" })).toBe("Agent w1:p2");
});

it("groups by tab identity, not equal labels, and includes mixed and shell-only splits", () => {
  const secondAgent = { ...agent, name: "backend", pane_id: "w1:p2" };
  const otherTab = { ...agent, pane_id: "w1:p4", tab_id: "w1:t2" };
  const shells = [
    shell,
    { ...shell, pane_id: "w1:p5", tab_id: "w1:t3" },
    { ...shell, pane_id: "w1:p6", tab_id: "w1:t3" },
  ];
  const groups = groupPanesByTab([agent, secondAgent, otherTab], shells);
  expect(groups).toHaveLength(3);
  expect(groups[0]).toMatchObject({ agents: [agent, secondAgent], shells: [shell] });
  expect(groups[1]?.agents).toEqual([otherTab]);
  expect(groups[2]?.shells).toEqual(shells.slice(1));
});

it("preserves empty workspaces and keeps matching tab labels in separate workspaces", () => {
  const secondAgent = { ...agent, pane_id: "w2:p1", tab_id: "w2:t1", workspace_id: "w2" };
  const groups = groupAgentsByWorkspace(
    [agent, secondAgent],
    [],
    [
      { workspace_id: "w1", label: "First" },
      { workspace_id: "w2", label: "Second" },
      { workspace_id: "w3", label: "Empty" },
    ],
  );
  expect(groups.map((group) => group.agents.length)).toEqual([1, 1, 0]);
  expect(groups.map((group) => groupPanesByTab(group.agents, group.tabs).length)).toEqual([
    1, 1, 0,
  ]);
});

it("uses a shell's workspace label when the workspace is absent from the snapshot", () => {
  expect(groupAgentsByWorkspace([], [shell], [])[0]?.label).toBe("Project");
});
