import overviewStyles from "./agentOverview.module.css";
import a11yStyles from "../../styles/accessibility.module.css";
import { useCallback, useState } from "react";
import type { Agent, ShellTab, Workspace } from "../../shared/api/contracts";
import { IconButton, SearchField, SegmentedTabs, SpeedDial } from "../../shared/ui";
import { SettingsIcon } from "../../shared/ui/Icons";
import { FlatAgentList, WorkspaceList } from "./AgentOverview";
import { FernblickMark } from "../../shared/ui/FernblickMark";
import { PastChats } from "./PastChats";
import { Snackbar } from "../../shared/ui/Snackbar";
import { ConnectionStatus } from "../../shared/ui/ConnectionStatus";

interface AgentListProps {
  agents: Agent[];
  connected: boolean;
  onOpenSettings: () => void;
  onCreate: (workspaceId?: string) => void;
  onCreateTab: () => void;
  onCreateWorkspace: () => void;
  onSelect: (agent: Agent) => void;
  onResumed: (agent: Agent) => void;
  onSelectTab: (tab: ShellTab) => void;
  selectedPaneId: string | null;
  tabs: ShellTab[];
  workspaces: Workspace[];
}
type OverviewView = "workspaces" | "agents" | "history";
const options = [
  { value: "workspaces", label: "Workspaces" },
  { value: "agents", label: "Agents" },
  { value: "history", label: "Past sessions" },
] as const;

export function AgentList({
  agents,
  connected,
  onOpenSettings,
  onCreate,
  onCreateTab,
  onCreateWorkspace,
  onSelect,
  onResumed,
  onSelectTab,
  selectedPaneId,
  tabs,
  workspaces,
}: AgentListProps) {
  const [view, setView] = useState<OverviewView>("workspaces");
  const [query, setQuery] = useState("");
  const [removalNotice, setRemovalNotice] = useState(0);
  const dismissNotice = useCallback(() => setRemovalNotice(0), []);
  const actions = [
    {
      id: "agent",
      label: "New Agent",
      description: "Start Pi in a workspace",
      kind: "agent" as const,
      onSelect: () => onCreate(),
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
    <nav
      className={overviewStyles["agent-list"]}
      data-testid="agent-list"
      data-ui="agent-list"
      aria-label="Herdr Web overview"
    >
      <header className={overviewStyles["overview-header"]} data-testid="overview-header">
        <div className={overviewStyles["overview-header__title"]}>
          <div className={overviewStyles["overview-brand"]}>
            <FernblickMark />
            <h1>
              <span className={a11yStyles["sr-only"]}>Fernblick</span>
              <img
                className={overviewStyles["overview-wordmark"]}
                src="/icons/scout-wordmark.png"
                width={564}
                height={126}
                alt=""
                aria-hidden="true"
              />
            </h1>
          </div>
          <div className={overviewStyles["overview-actions"]}>
            <ConnectionStatus connected={connected} />
            <IconButton
              type="button"
              label="Open settings"
              aria-haspopup="dialog"
              onClick={onOpenSettings}
            >
              <SettingsIcon />
            </IconButton>
          </div>
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
          label={
            view === "history"
              ? "Search past sessions"
              : view === "workspaces"
                ? "Search workspaces"
                : "Search agents"
          }
          placeholder={
            view === "history"
              ? "Search past sessions"
              : view === "workspaces"
                ? "Search workspaces"
                : "Search agents"
          }
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </header>
      <div className={overviewStyles["overview-content"]}>
        {view === "history" ? (
          <PastChats
            query={query}
            workspaces={workspaces}
            onResumed={onResumed}
            onRemoved={() => setRemovalNotice((notice) => notice + 1)}
          />
        ) : view === "workspaces" ? (
          <WorkspaceList
            agents={agents}
            tabs={tabs}
            workspaces={workspaces}
            selectedPaneId={selectedPaneId}
            onCreateAgent={onCreate}
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
      {removalNotice > 0 && (
        <Snackbar key={removalNotice} message="Session removed" onDismiss={dismissNotice} />
      )}
    </nav>
  );
}
