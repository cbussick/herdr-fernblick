import overviewStyles from "./agentOverview.module.css";
import uiStyles from "../../shared/ui/ui.module.css";
import type { Agent, AgentStatus, ShellTab, Workspace } from "../../shared/api/contracts";
import { ChevronIcon, FolderIcon, SearchIcon } from "../../shared/ui/Icons";
import { StatusIndicator, TabKindIcon } from "../../shared/ui";
import {
  getAgentTabLabel,
  getStatusLabel,
  groupAgentsByWorkspace,
} from "../../features/agents/agentPresentation";
import { PaneContextActions } from "./PaneContextActions";

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
          className={overviewStyles["pane-row"]}
          data-testid="pane-row"
          data-selected={selected || undefined}
          aria-current={selected ? "page" : undefined}
          onClick={onClick}
          {...handlers}
        >
          <TabKindIcon kind={kind} />
          <span className={overviewStyles["pane-row__copy"]}>
            <strong>{title}</strong>
            <small>{subtitle}</small>
          </span>
          {status ? (
            <StatusIndicator status={status} label={getStatusLabel(status)} />
          ) : (
            <span className={overviewStyles["pane-row__shell"]}>Shell</span>
          )}
          <ChevronIcon className={overviewStyles["pane-row__chevron"]} />
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
      <div className={overviewStyles["overview-empty"]} data-testid="overview-empty">
        <span className={uiStyles["empty-state-icon"]} data-testid="empty-state-icon">
          {normalized ? <SearchIcon /> : <FolderIcon />}
        </span>
        <strong>{normalized ? "No workspaces found" : "No workspaces yet"}</strong>
        <p>{normalized ? "Try a different search." : "Use the create menu to add a workspace."}</p>
      </div>
    );
  return (
    <div className={overviewStyles["workspace-list"]}>
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
            className={overviewStyles["workspace-disclosure"]}
            data-testid="workspace-disclosure"
            key={group.workspace_id}
            open={normalized ? true : undefined}
          >
            <summary>
              <span className={overviewStyles["workspace-disclosure__copy"]}>
                <strong>{group.label}</strong>
                <small>
                  {group.agents.length} {group.agents.length === 1 ? "agent" : "agents"}
                  {group.tabs.length
                    ? ` / ${group.tabs.length} ${group.tabs.length === 1 ? "shell" : "shells"}`
                    : ""}
                </small>
              </span>
              <StatusIndicator status={status} label={getStatusLabel(status)} />
              <ChevronIcon />
            </summary>
            <div className={overviewStyles["workspace-disclosure__content"]}>
              {groupAgents.map((agent) => (
                <PaneRow
                  key={agent.pane_id}
                  title={getAgentTabLabel(agent)}
                  subtitle="Pi agent"
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
    <div className={overviewStyles["flat-agent-list"]}>
      <p className={overviewStyles["flat-agent-list__label"]}>All agents across workspaces</p>
      {visible.length ? (
        visible.map((agent) => (
          <PaneRow
            key={agent.pane_id}
            title={getAgentTabLabel(agent)}
            subtitle={agent.workspace_label ?? agent.workspace_id}
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
        <div className={overviewStyles["overview-empty"]} data-testid="overview-empty">
          <span className={uiStyles["empty-state-icon"]} data-testid="empty-state-icon">
            <SearchIcon />
          </span>
          <strong>No agents found</strong>
          <p>Try a different search.</p>
        </div>
      )}
    </div>
  );
}
