import appStyles from "./App.module.css";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Agent, ShellTab, Workspace } from "../shared/api/contracts";
import { getAgents } from "../shared/api/apiClient";
import { AgentList } from "../features/agents/AgentList";
import { AgentConsole } from "../features/agents/AgentConsole";
import { NewAgentDialog } from "../features/agents/NewAgentDialog";
import { NewWorkspaceDialog } from "../features/agents/NewWorkspaceDialog";
import { NewTabDialog } from "../features/agents/NewTabDialog";
import { ShellConsole } from "../features/agents/ShellConsole";
import { FernblickMark } from "../shared/ui/FernblickMark";
import { LoadingBrand } from "../shared/ui/LoadingBrand";
import { StateIcon } from "../shared/ui/StateFeedback";
import { useSinglePaneLayout } from "./useSinglePaneLayout";
import { useReadAgentStatuses } from "./useReadAgentStatuses";
import { usePaneNavigation } from "./usePaneNavigation";
import { SettingsDialog } from "./SettingsDialog";
import { useVisualViewport } from "./useVisualViewport";
import { useHeaderDiagnostics } from "./useHeaderDiagnostics";

export function App() {
  const viewportRef = useVisualViewport();
  useHeaderDiagnostics();
  const singlePane = useSinglePaneLayout();
  const queryClient = useQueryClient();
  const [selectedPaneId, setSelectedPaneId] = usePaneNavigation();
  const [createDialog, setCreateDialog] = useState<{ workspaceId?: string } | null>(null);
  const [workspaceDialogOpen, setWorkspaceDialogOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tabDialogOpen, setTabDialogOpen] = useState(false);
  const agentsQuery = useQuery({
    queryKey: ["agents"],
    queryFn: getAgents,
    refetchInterval: 2_000,
  });

  const {
    agents,
    error: readError,
    retry: retryRead,
    dismissError: dismissReadError,
  } = useReadAgentStatuses(
    agentsQuery.data?.agents ?? [],
    agentsQuery.isSuccess ? selectedPaneId : null,
  );
  const tabs = agentsQuery.data?.tabs ?? [];
  const workspaces = agentsQuery.data?.workspaces ?? [];
  const selectedAgent = agents.find((agent) => agent.pane_id === selectedPaneId) ?? null;
  const selectedTab = tabs.find((tab) => tab.pane_id === selectedPaneId) ?? null;
  const detailOpen = selectedAgent || selectedTab;

  function handleWorkspaceCreated(workspace: Workspace) {
    queryClient.setQueryData(
      ["agents"],
      (current: Awaited<ReturnType<typeof getAgents>> | undefined) =>
        current
          ? {
              ...current,
              workspaces: [
                ...current.workspaces.filter(
                  (item) => item.workspace_id !== workspace.workspace_id,
                ),
                workspace,
              ],
            }
          : current,
    );
    void agentsQuery.refetch();
  }

  return (
    <div
      ref={viewportRef}
      className={appStyles["app-shell"]}
      data-detail-open={detailOpen ? true : undefined}
      data-single-pane={singlePane ? true : undefined}
    >
      <a href="#main-content" className={appStyles["skip-link"]}>
        Skip to content
      </a>

      {readError && (
        <div className={appStyles["read-error"]} role="alert">
          <p>Could not save read status. The answer may appear new after reopening.</p>
          <button type="button" onClick={retryRead}>
            Retry
          </button>
          <button type="button" onClick={dismissReadError}>
            Dismiss
          </button>
        </div>
      )}

      {agentsQuery.isPending && agentsQuery.isPaused ? (
        <div className={appStyles["page-state"]} data-testid="page-state" role="status">
          <StateIcon kind="unavailable" />
          <h1>Fernblick is offline</h1>
          <p>Connect to your tailnet to load agents. This screen will reconnect automatically.</p>
        </div>
      ) : agentsQuery.isPending ? (
        <div
          className={appStyles["page-state"]}
          data-testid="page-state"
          data-ui="app-loading"
          role="status"
          aria-busy="true"
        >
          <LoadingBrand />
        </div>
      ) : agentsQuery.isError && !agentsQuery.data ? (
        <div className={appStyles["page-state"]} data-testid="page-state" role="alert">
          <StateIcon kind="unavailable" />
          <h1>Cannot reach Herdr</h1>
          <p>{agentsQuery.error.message}</p>
          <button type="button" onClick={() => void agentsQuery.refetch()}>
            Try again
          </button>
        </div>
      ) : (
        <div className={appStyles["workspace"]}>
          <AgentList
            onOpenSettings={() => setSettingsOpen(true)}
            agents={agents}
            connected={!agentsQuery.isError && !agentsQuery.isPaused}
            tabs={tabs}
            onCreate={(workspaceId) => setCreateDialog({ workspaceId })}
            onCreateTab={() => setTabDialogOpen(true)}
            onCreateWorkspace={() => setWorkspaceDialogOpen(true)}
            selectedPaneId={selectedPaneId}
            workspaces={workspaces}
            onSelect={(agent: Agent) => setSelectedPaneId(agent.pane_id)}
            onResumed={(agent) => {
              queryClient.setQueryData(
                ["agents"],
                (current: Awaited<ReturnType<typeof getAgents>> | undefined) =>
                  current
                    ? {
                        ...current,
                        agents: [
                          ...current.agents.filter((item) => item.pane_id !== agent.pane_id),
                          agent,
                        ],
                        tabs: current.tabs.filter((tab) => tab.tab_id !== agent.tab_id),
                      }
                    : current,
              );
              setSelectedPaneId(agent.pane_id);
              void agentsQuery.refetch();
            }}
            onSelectTab={(tab: ShellTab) => setSelectedPaneId(tab.pane_id)}
          />
          {selectedAgent ? (
            <AgentConsole
              key={selectedAgent.pane_id}
              agent={selectedAgent}
              onBack={() => setSelectedPaneId(null)}
            />
          ) : selectedTab ? (
            <ShellConsole tab={selectedTab} onBack={() => setSelectedPaneId(null)} />
          ) : (
            <main className={appStyles["console-empty"]} id="main-content">
              <FernblickMark className={appStyles["console-empty__mark"]} />
              <h2>Keep your agents in view.</h2>
              <p>Choose an agent to pick up the conversation, or a shell to open its terminal.</p>
            </main>
          )}
        </div>
      )}

      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
      {createDialog && (
        <NewAgentDialog
          open
          initialWorkspaceId={createDialog.workspaceId}
          workspaces={workspaces}
          onClose={() => setCreateDialog(null)}
          onWorkspaceCreated={handleWorkspaceCreated}
          onCreated={(agent) => {
            setSelectedPaneId(agent.pane_id);
            setCreateDialog(null);
            void agentsQuery.refetch();
          }}
        />
      )}
      {workspaceDialogOpen && (
        <NewWorkspaceDialog
          onClose={() => setWorkspaceDialogOpen(false)}
          onCreated={(workspace) => {
            setWorkspaceDialogOpen(false);
            handleWorkspaceCreated(workspace);
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
