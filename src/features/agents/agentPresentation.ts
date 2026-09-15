import type { Agent, AgentStatus, ShellTab, Workspace } from "../../shared/api/contracts";

const statusLabels: Record<AgentStatus, string> = {
  blocked: "Needs input",
  done: "New answer",
  idle: "Idle",
  unknown: "Unknown",
  working: "Working",
};

export function getAgentLabel(agent: Agent) {
  return (
    agent.display_agent ??
    agent.title ??
    agent.name ??
    agent.terminal_title_stripped ??
    agent.agent ??
    agent.pane_id
  );
}

export function getAgentTarget(agent: Agent) {
  return agent.name ?? agent.pane_id;
}

export function getAgentTabLabel(agent: Agent) {
  return agent.tab_label ?? agent.title ?? agent.tab_id;
}

export function getAgentSubtitle(agent: Agent) {
  const label = getAgentLabel(agent);
  const path = agent.foreground_cwd ?? agent.cwd;
  if (!path) return label;

  const directory = path.split("/").filter(Boolean).at(-1);
  return directory && directory !== label ? `${label} · ${directory}` : label;
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
      group = { workspace_id: tab.workspace_id, label: tab.workspace_id, agents: [], tabs: [] };
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
