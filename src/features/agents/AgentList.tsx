import { useState } from "react";
import type { Agent, ShellTab, Workspace } from "../../shared/api/contracts";
import { SearchField, SegmentedTabs, SpeedDial } from "../../shared/ui";
import { FlatAgentList, WorkspaceList } from "./AgentOverview";

interface AgentListProps {
  agents: Agent[];
  onCreate: () => void;
  onCreateTab: () => void;
  onCreateWorkspace: () => void;
  onSelect: (agent: Agent) => void;
  onSelectTab: (tab: ShellTab) => void;
  selectedPaneId: string | null;
  tabs: ShellTab[];
  workspaces: Workspace[];
}
type OverviewView = "workspaces" | "agents";
const options = [
  { value: "workspaces", label: "Workspaces" },
  { value: "agents", label: "Agents" },
] as const;

export function AgentList({
  agents,
  onCreate,
  onCreateTab,
  onCreateWorkspace,
  onSelect,
  onSelectTab,
  selectedPaneId,
  tabs,
  workspaces,
}: AgentListProps) {
  const [view, setView] = useState<OverviewView>("workspaces");
  const [query, setQuery] = useState("");
  const actions = [
    {
      id: "agent",
      label: "New Agent",
      description: "Start Pi in a workspace",
      kind: "agent" as const,
      onSelect: onCreate,
    },
    {
      id: "shell",
      label: "New Shell Tab",
      description: "Open a regular terminal",
      kind: "shell" as const,
      onSelect: onCreateTab,
    },
    {
      id: "workspace",
      label: "New Workspace",
      description: "Add another project",
      kind: "workspace" as const,
      onSelect: onCreateWorkspace,
    },
  ].filter((action) => workspaces.length > 0 || action.id === "workspace");
  return (
    <nav className="agent-list" aria-label="Herdr Web overview">
      <header className="overview-header">
        <div className="overview-header__title">
          <h1>Herdr Web</h1>
          <span className="connection-state">
            <i />
            Connected
          </span>
        </div>
        <SegmentedTabs
          label="Overview"
          value={view}
          options={options}
          onChange={(next) => {
            setView(next);
            setQuery("");
          }}
        />
        <SearchField
          label={view === "workspaces" ? "Search workspaces" : "Search agents"}
          placeholder={view === "workspaces" ? "Search workspaces" : "Search agents"}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </header>
      <div className="overview-content">
        {view === "workspaces" ? (
          <WorkspaceList
            agents={agents}
            tabs={tabs}
            workspaces={workspaces}
            selectedPaneId={selectedPaneId}
            onSelectAgent={onSelect}
            onSelectTab={onSelectTab}
            query={query}
          />
        ) : (
          <FlatAgentList
            agents={agents}
            selectedPaneId={selectedPaneId}
            onSelect={onSelect}
            query={query}
          />
        )}
      </div>
      <SpeedDial actions={actions} />
    </nav>
  );
}
