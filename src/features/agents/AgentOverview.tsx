import type { Agent, AgentStatus, ShellTab, Workspace } from "../../shared/api/contracts";
import { ChevronIcon } from "../../shared/ui/Icons";
import { StatusIndicator, TabKindIcon } from "../../shared/ui";
import {
  getAgentTabLabel,
  getStatusLabel,
  groupAgentsByWorkspace,
} from "../../features/agents/agentPresentation";
import { PaneContextActions } from "./PaneContextActions";
import "./agentOverview.css";

const priority: Record<AgentStatus, number> = {
  blocked: 5,
  done: 4,
  working: 3,
  unknown: 2,
  idle: 1,
};
const getWorkspaceStatus = (agents: Agent[]): AgentStatus =>
  agents.reduce<AgentStatus>(
    (highest, agent) =>
      priority[agent.agent_status] > priority[highest] ? agent.agent_status : highest,
    "idle",
  );

export function PaneRow({
  title,
  subtitle,
  kind,
  status,
  selected,
  tabId,
  agentName,
  agentTarget,
  onClick,
}: {
  title: string;
  subtitle: string;
  kind: "agent" | "shell";
  status?: AgentStatus;
  selected?: boolean;
  tabId: string;
  agentName?: string | null;
  agentTarget?: string;
  onClick: () => void;
}) {
  return (
    <PaneContextActions
      tabId={tabId}
      label={title}
      agentRunning={kind === "agent"}
      agentName={agentName}
      agentTarget={agentTarget}
    >
      {(handlers) => (
        <button
          type="button"
          className="pane-row"
          data-selected={selected || undefined}
          aria-current={selected ? "page" : undefined}
          onClick={onClick}
          {...handlers}
        >
          <TabKindIcon kind={kind} />
          <span className="pane-row__copy">
            <strong>{title}</strong>
            <small>{subtitle}</small>
          </span>
          {status ? (
            <StatusIndicator status={status} label={getStatusLabel(status)} />
          ) : (
            <span className="pane-row__shell">Shell</span>
          )}
          <ChevronIcon className="pane-row__chevron" />
        </button>
      )}
    </PaneContextActions>
  );
}

export function WorkspaceList({
  agents,
  tabs,
  workspaces,
  selectedPaneId,
  onSelectAgent,
  onSelectTab,
  query,
}: {
  agents: Agent[];
  tabs: ShellTab[];
  workspaces: Workspace[];
  selectedPaneId: string | null;
  onSelectAgent: (agent: Agent) => void;
  onSelectTab: (tab: ShellTab) => void;
  query: string;
}) {
  const normalized = query.trim().toLowerCase();
  const groups = groupAgentsByWorkspace(agents, tabs, workspaces).filter(
    (group) =>
      !normalized ||
      group.label.toLowerCase().includes(normalized) ||
      group.agents.some((a) => getAgentTabLabel(a).toLowerCase().includes(normalized)) ||
      group.tabs.some((t) => t.label.toLowerCase().includes(normalized)),
  );
  if (groups.length === 0)
    return (
      <div className="overview-empty">
        <strong>No workspaces found</strong>
        <p>Try a different search.</p>
      </div>
    );
  return (
    <div className="workspace-list">
      {groups.map((group) => {
        const groupAgents = group.agents.filter(
          (a) =>
            !normalized ||
            group.label.toLowerCase().includes(normalized) ||
            getAgentTabLabel(a).toLowerCase().includes(normalized),
        );
        const groupTabs = group.tabs.filter(
          (t) =>
            !normalized ||
            group.label.toLowerCase().includes(normalized) ||
            t.label.toLowerCase().includes(normalized),
        );
        const status = getWorkspaceStatus(group.agents);
        return (
          <details
            className="workspace-disclosure"
            key={group.workspace_id}
            open={normalized ? true : undefined}
          >
            <summary>
              <strong>{group.label}</strong>
              <StatusIndicator status={status} label={getStatusLabel(status)} />
              <ChevronIcon />
            </summary>
            <div className="workspace-disclosure__content">
              {groupAgents.map((agent) => (
                <PaneRow
                  key={agent.pane_id}
                  title={getAgentTabLabel(agent)}
                  subtitle={
                    agent.agent_status === "done"
                      ? "New answer"
                      : getStatusLabel(agent.agent_status)
                  }
                  kind="agent"
                  tabId={agent.tab_id}
                  agentName={agent.name}
                  agentTarget={agent.name ?? agent.pane_id}
                  status={agent.agent_status}
                  selected={agent.pane_id === selectedPaneId}
                  onClick={() => onSelectAgent(agent)}
                />
              ))}
              {groupTabs.map((tab) => (
                <PaneRow
                  key={tab.tab_id}
                  title={tab.label}
                  subtitle="Shell terminal"
                  kind="shell"
                  tabId={tab.tab_id}
                  selected={tab.pane_id === selectedPaneId}
                  onClick={() => onSelectTab(tab)}
                />
              ))}
            </div>
          </details>
        );
      })}
    </div>
  );
}

export function FlatAgentList({
  agents,
  selectedPaneId,
  onSelect,
  query,
}: {
  agents: Agent[];
  selectedPaneId: string | null;
  onSelect: (agent: Agent) => void;
  query: string;
}) {
  const normalized = query.trim().toLowerCase();
  const visible = agents.filter(
    (agent) =>
      !normalized ||
      getAgentTabLabel(agent).toLowerCase().includes(normalized) ||
      (agent.workspace_label ?? "").toLowerCase().includes(normalized),
  );
  return (
    <div className="flat-agent-list">
      <p className="flat-agent-list__label">All agents across workspaces</p>
      {visible.length ? (
        visible.map((agent) => (
          <PaneRow
            key={agent.pane_id}
            title={getAgentTabLabel(agent)}
            subtitle={`${getStatusLabel(agent.agent_status)} · ${agent.workspace_label ?? agent.workspace_id}`}
            kind="agent"
            tabId={agent.tab_id}
            agentName={agent.name}
            agentTarget={agent.name ?? agent.pane_id}
            status={agent.agent_status}
            selected={agent.pane_id === selectedPaneId}
            onClick={() => onSelect(agent)}
          />
        ))
      ) : (
        <div className="overview-empty">
          <strong>No agents found</strong>
          <p>Try a different search.</p>
        </div>
      )}
    </div>
  );
}
