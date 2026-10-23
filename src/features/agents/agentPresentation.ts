import type { Agent, AgentStatus, ShellTab, Workspace } from "../../shared/api/contracts";

const statusLabels: Record<AgentStatus, string> = {
  blocked: "Needs input",
  done: "New answer",
  idle: "Idle",
  unknown: "Unknown",
  working: "Working",
};

export function getAgentTarget(agent: Agent) {
  return agent.name ?? agent.pane_id;
}

export function getAgentTabLabel(agent: Agent) {
  return agent.tab_label?.trim() || agent.title?.trim() || agent.tab_id;
}

export function getAgentLabel(agent: Agent) {
  // Pane IDs are stable across polling, reordering and changes to the tab title.
  return agent.name?.trim() || `Agent ${agent.pane_id}`;
}

export function groupPanesByTab(agents: Agent[], shells: ShellTab[]) {
  const groups = new Map<
    string,
    { tab_id: string; label: string; agents: Agent[]; shells: ShellTab[] }
  >();
  for (const agent of agents) {
    let group = groups.get(agent.tab_id);
    if (!group) {
      group = { tab_id: agent.tab_id, label: getAgentTabLabel(agent), agents: [], shells: [] };
      groups.set(agent.tab_id, group);
    }
    group.agents.push(agent);
  }
  for (const shell of shells) {
    let group = groups.get(shell.tab_id);
    if (!group) {
      group = { tab_id: shell.tab_id, label: shell.label, agents: [], shells: [] };
      groups.set(shell.tab_id, group);
    }
    group.shells.push(shell);
  }
  return [...groups.values()];
}

export function groupAgentsByWorkspace(agents: Agent[], tabs: ShellTab[], workspaces: Workspace[]) {
  const groups = workspaces.map((workspace) => ({
    ...workspace,
    agents: [] as Agent[],
    tabs: [] as ShellTab[],
  }));
  const groupsById = new Map(groups.map((group) => [group.workspace_id, group]));

  for (const agent of agents) {
    let group = groupsById.get(agent.workspace_id);
    if (!group) {
      group = {
        workspace_id: agent.workspace_id,
        label: agent.workspace_label ?? agent.workspace_id,
        agents: [],
        tabs: [],
      };
      groups.push(group);
      groupsById.set(group.workspace_id, group);
    }
    group.agents.push(agent);
  }

  for (const tab of tabs) {
    let group = groupsById.get(tab.workspace_id);
    if (!group) {
      group = {
        workspace_id: tab.workspace_id,
        label: tab.workspace_label ?? tab.workspace_id,
        agents: [],
        tabs: [],
      };
      groups.push(group);
      groupsById.set(group.workspace_id, group);
    }
    group.tabs.push(tab);
  }

  return groups;
}

export function getStatusLabel(status: AgentStatus) {
  return statusLabels[status];
}
