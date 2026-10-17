import overviewStyles from "./agentOverview.module.css";
import uiStyles from "../../shared/ui/ui.module.css";
import { useEffect, useRef } from "react";
import type { Agent, AgentStatus, ShellTab, Workspace } from "../../shared/api/contracts";
import { ChevronIcon, FolderIcon, PlusIcon, SearchIcon } from "../../shared/ui/Icons";
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

function WorkspaceSummary({
  label,
  agentCount,
  shellCount,
  status,
  onCreateAgent,
}: {
  label: string;
  agentCount: number;
  shellCount: number;
  status: AgentStatus;
  onCreateAgent: () => void;
}) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const origin = useRef({ x: 0, y: 0 });
  const suppressClick = useRef(false);

  function clearPress() {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }
  useEffect(() => clearPress, []);

  return (
    <summary
      onPointerDown={(event) => {
        clearPress();
        suppressClick.current = false;
        if (event.pointerType === "mouse" || event.button !== 0 || !event.isPrimary) return;
        origin.current = { x: event.clientX, y: event.clientY };
        timer.current = setTimeout(() => {
          timer.current = null;
          suppressClick.current = true;
          onCreateAgent();
        }, 550);
      }}
      onPointerMove={(event) => {
        if (Math.hypot(event.clientX - origin.current.x, event.clientY - origin.current.y) > 10) {
          clearPress();
        }
      }}
      onPointerUp={clearPress}
      onPointerCancel={clearPress}
      onPointerLeave={clearPress}
      onContextMenu={(event) => event.preventDefault()}
      onClick={(event) => {
        if (!suppressClick.current || event.detail === 0) return;
        event.preventDefault();
        event.stopPropagation();
        suppressClick.current = false;
      }}
    >
      <span className={overviewStyles["workspace-disclosure__copy"]}>
        <strong>{label}</strong>
        <small>
          {agentCount} {agentCount === 1 ? "agent" : "agents"}
          {shellCount ? ` / ${shellCount} ${shellCount === 1 ? "shell" : "shells"}` : ""}
        </small>
      </span>
      <StatusIndicator status={status} label={getStatusLabel(status)} />
      <button
        type="button"
        className={overviewStyles["workspace-disclosure__create"]}
        aria-label={`Create agent in ${label}`}
        title={`Create agent in ${label}`}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onCreateAgent();
        }}
      >
        <PlusIcon />
      </button>
      <ChevronIcon />
    </summary>
  );
}

export function WorkspaceList({
  agents,
  tabs,
  workspaces,
  selectedPaneId,
  onSelectAgent,
  onSelectTab,
  onCreateAgent,
  query,
}: {
  agents: Agent[];
  tabs: ShellTab[];
  workspaces: Workspace[];
  selectedPaneId: string | null;
  onSelectAgent: (agent: Agent) => void;
  onSelectTab: (tab: ShellTab) => void;
  onCreateAgent: (workspaceId: string) => void;
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
            <WorkspaceSummary
              label={group.label}
              agentCount={group.agents.length}
              shellCount={group.tabs.length}
              status={status}
              onCreateAgent={() => onCreateAgent(group.workspace_id)}
            />
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
