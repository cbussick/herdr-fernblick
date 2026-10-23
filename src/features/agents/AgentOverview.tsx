import { useState, type ReactNode } from "react";
import overviewStyles from "./agentOverview.module.css";
import uiStyles from "../../shared/ui/ui.module.css";
import type { Agent, AgentStatus, ShellTab, Workspace } from "../../shared/api/contracts";
import { ChevronIcon, FolderIcon, PlusIcon, SearchIcon } from "../../shared/ui/Icons";
import { StatusIndicator, TabKindIcon } from "../../shared/ui";
import {
  getAgentLabel,
  getAgentTabLabel,
  getStatusLabel,
  groupAgentsByWorkspace,
  groupPanesByTab,
} from "./agentPresentation";
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

function paneCountLabel(agentCount: number, shellCount: number) {
  return [
    agentCount ? `${agentCount} ${agentCount === 1 ? "agent" : "agents"}` : "",
    shellCount ? `${shellCount} ${shellCount === 1 ? "shell" : "shells"}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

function agentMatches(agent: Agent, query: string) {
  return [getAgentLabel(agent), getAgentTabLabel(agent)].some((value) =>
    value.toLowerCase().includes(query),
  );
}

function PaneRow({
  title,
  subtitle,
  tabLabel,
  kind,
  status,
  selected,
  tabId,
  agentName,
  agentTarget,
  onClick,
}: {
  title: string;
  subtitle?: string;
  tabLabel: string;
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
      label={tabLabel}
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
            {subtitle && <small>{subtitle}</small>}
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

type TabGroup = ReturnType<typeof groupPanesByTab>[number];

function WorkspaceTab({
  tab,
  query,
  workspaceMatches,
  selectedPaneId,
  onSelectAgent,
  onSelectTab,
}: {
  tab: TabGroup;
  query: string;
  workspaceMatches: boolean;
  selectedPaneId: string | null;
  onSelectAgent: (agent: Agent) => void;
  onSelectTab: (tab: ShellTab) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const showAll = workspaceMatches || tab.label.toLowerCase().includes(query);
  const agents = tab.agents.filter((agent) => showAll || agentMatches(agent, query));
  const shells = tab.shells.filter(
    (shell) => showAll || shell.pane_id.toLowerCase().includes(query),
  );
  const multiple = tab.agents.length + tab.shells.length > 1;
  const header = (
    <>
      <span className={overviewStyles["tab-group__copy"]}>
        <strong>{tab.label}</strong>
      </span>
      <small>Tab</small>
      {multiple && <ChevronIcon />}
    </>
  );
  const panes = (
    <div className={overviewStyles["tab-group__panes"]}>
      {agents.map((agent) => (
        <PaneRow
          key={agent.pane_id}
          title={getAgentLabel(agent)}
          tabLabel={tab.label}
          kind="agent"
          tabId={agent.tab_id}
          agentName={agent.name}
          agentTarget={agent.name ?? agent.pane_id}
          status={agent.agent_status}
          selected={agent.pane_id === selectedPaneId}
          onClick={() => onSelectAgent(agent)}
        />
      ))}
      {shells.map((shell) => (
        <PaneRow
          key={shell.pane_id}
          title={tab.shells.length > 1 ? `Shell ${shell.pane_id}` : "Shell terminal"}
          tabLabel={tab.label}
          kind="shell"
          tabId={shell.tab_id}
          selected={shell.pane_id === selectedPaneId}
          onClick={() => onSelectTab(shell)}
        />
      ))}
    </div>
  );
  if (!multiple)
    return (
      <section
        className={overviewStyles["tab-group"]}
        data-testid="tab-group"
        data-split={false}
        aria-label={tab.label}
      >
        <div className={overviewStyles["tab-group__header"]}>{header}</div>
        {panes}
      </section>
    );
  return (
    <details
      className={overviewStyles["tab-group"]}
      data-testid="tab-group"
      data-split
      aria-label={tab.label}
      open={!!query || expanded}
      onToggle={(event) => {
        if (!query) setExpanded(event.currentTarget.open);
      }}
    >
      <summary className={overviewStyles["tab-group__header"]}>{header}</summary>
      {panes}
    </details>
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
  return (
    <summary>
      <span className={overviewStyles["workspace-disclosure__copy"]}>
        <strong>{label}</strong>
        <small>{paneCountLabel(agentCount, shellCount) || "0 agents"}</small>
      </span>
      {agentCount > 0 && <StatusIndicator status={status} label={getStatusLabel(status)} />}
      <button
        type="button"
        className={overviewStyles["workspace-disclosure__create"]}
        aria-label={`Create agent in ${label}`}
        title={`Create agent in ${label}`}
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

function WorkspaceDisclosure({ forceOpen, children }: { forceOpen: boolean; children: ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <details
      className={overviewStyles["workspace-disclosure"]}
      data-testid="workspace-disclosure"
      open={forceOpen || expanded}
      onToggle={(event) => {
        if (!forceOpen) setExpanded(event.currentTarget.open);
      }}
    >
      {children}
    </details>
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
  const groups = groupAgentsByWorkspace(agents, tabs, workspaces)
    .map((group) => {
      const tabGroups = groupPanesByTab(group.agents, group.tabs);
      const workspaceMatches = group.label.toLowerCase().includes(normalized);
      const visibleTabs = tabGroups.filter(
        (tab) =>
          workspaceMatches ||
          tab.label.toLowerCase().includes(normalized) ||
          tab.agents.some((agent) => agentMatches(agent, normalized)) ||
          tab.shells.some((shell) => shell.pane_id.toLowerCase().includes(normalized)),
      );
      return { ...group, visibleTabs, workspaceMatches };
    })
    .filter((group) => group.workspaceMatches || group.visibleTabs.length > 0);
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
      {groups.map((group) => (
        <WorkspaceDisclosure key={group.workspace_id} forceOpen={!!normalized}>
          <WorkspaceSummary
            label={group.label}
            agentCount={group.agents.length}
            shellCount={group.tabs.length}
            status={getWorkspaceStatus(group.agents)}
            onCreateAgent={() => onCreateAgent(group.workspace_id)}
          />
          <div className={overviewStyles["workspace-disclosure__content"]}>
            {group.visibleTabs.map((tab) => (
              <WorkspaceTab
                key={tab.tab_id}
                tab={tab}
                query={normalized}
                workspaceMatches={group.workspaceMatches}
                selectedPaneId={selectedPaneId}
                onSelectAgent={onSelectAgent}
                onSelectTab={onSelectTab}
              />
            ))}
          </div>
        </WorkspaceDisclosure>
      ))}
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
      agentMatches(agent, normalized) ||
      (agent.workspace_label ?? agent.workspace_id).toLowerCase().includes(normalized),
  );
  return (
    <div className={overviewStyles["flat-agent-list"]}>
      <p className={overviewStyles["flat-agent-list__label"]}>All agents across workspaces</p>
      {visible.length ? (
        visible.map((agent) => (
          <PaneRow
            key={agent.pane_id}
            title={getAgentLabel(agent)}
            subtitle={`${agent.workspace_label ?? agent.workspace_id} · Tab: ${getAgentTabLabel(agent)}`}
            tabLabel={getAgentTabLabel(agent)}
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
