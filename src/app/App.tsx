import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Agent, ShellTab } from "../shared/api/contracts";
import { getAgents } from "../shared/api/apiClient";
import { AgentList } from "../features/agents/AgentList";
import { AgentConsole } from "../features/agents/AgentConsole";
import { NewAgentDialog } from "../features/agents/NewAgentDialog";
import { NewWorkspaceDialog } from "../features/agents/NewWorkspaceDialog";
import { NewTabDialog } from "../features/agents/NewTabDialog";
import { ShellConsole } from "../features/agents/ShellConsole";
import "./App.css";

export function App() {
  const [selectedPaneId, setSelectedPaneId] = useState<string | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [workspaceDialogOpen, setWorkspaceDialogOpen] = useState(false);
  const [tabDialogOpen, setTabDialogOpen] = useState(false);
  const agentsQuery = useQuery({
    queryKey: ["agents"],
    queryFn: getAgents,
    refetchInterval: 2_000,
  });

  const agents = agentsQuery.data?.agents ?? [];
  const tabs = agentsQuery.data?.tabs ?? [];
  const workspaces = agentsQuery.data?.workspaces ?? [];
  const selectedAgent = agents.find((agent) => agent.pane_id === selectedPaneId) ?? null;
  const selectedTab = tabs.find((tab) => tab.pane_id === selectedPaneId) ?? null;
  const detailOpen = selectedAgent || selectedTab;

  return (
    <div className="app-shell" data-detail-open={detailOpen ? true : undefined}>
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>

      {agentsQuery.isPending ? (
        <div className="page-state" aria-busy="true">
          Loading agents…
        </div>
      ) : agentsQuery.isError ? (
        <div className="page-state page-state--error" role="alert">
          <h1>Cannot reach Herdr</h1>
          <p>{agentsQuery.error.message}</p>
          <button type="button" onClick={() => void agentsQuery.refetch()}>
            Try again
          </button>
        </div>
      ) : (
        <div className="workspace">
          <AgentList
            agents={agents}
            tabs={tabs}
            onCreate={() => setCreateDialogOpen(true)}
            onCreateTab={() => setTabDialogOpen(true)}
            onCreateWorkspace={() => setWorkspaceDialogOpen(true)}
            selectedPaneId={selectedPaneId}
            workspaces={workspaces}
            onSelect={(agent: Agent) => setSelectedPaneId(agent.pane_id)}
            onSelectTab={(tab: ShellTab) => setSelectedPaneId(tab.pane_id)}
          />
          {selectedAgent ? (
            <AgentConsole agent={selectedAgent} onBack={() => setSelectedPaneId(null)} />
          ) : selectedTab ? (
            <ShellConsole tab={selectedTab} onBack={() => setSelectedPaneId(null)} />
          ) : (
            <main className="console-empty" id="main-content">
              <p>Select a tab to view its terminal.</p>
            </main>
          )}
        </div>
      )}

      <NewAgentDialog
        open={createDialogOpen}
        workspaces={workspaces}
        onClose={() => setCreateDialogOpen(false)}
        onCreateWorkspace={() => setWorkspaceDialogOpen(true)}
        onCreated={(agent) => {
          setSelectedPaneId(agent.pane_id);
          setCreateDialogOpen(false);
          void agentsQuery.refetch();
        }}
      />
      {workspaceDialogOpen && (
        <NewWorkspaceDialog
          onClose={() => setWorkspaceDialogOpen(false)}
          onCreated={() => {
            setWorkspaceDialogOpen(false);
            void agentsQuery.refetch();
          }}
        />
      )}
      {tabDialogOpen && (
        <NewTabDialog
          workspaces={workspaces}
          onClose={() => setTabDialogOpen(false)}
          onCreated={(tab) => {
            setSelectedPaneId(tab.pane_id);
            setTabDialogOpen(false);
            void agentsQuery.refetch();
          }}
        />
      )}
    </div>
  );
}
