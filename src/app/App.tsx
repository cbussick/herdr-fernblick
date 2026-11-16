import appStyles from "./App.module.css";
import { useEffect, useState } from "react";
import { ResumeChatDialog } from "../features/agents/ResumeChatDialog";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Agent, ShellTab, Workspace } from "../shared/api/contracts";
import { getAgents, getSession, resumeChat } from "../shared/api/apiClient";
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
import type { usePaneNavigation } from "./usePaneNavigation";
import { SettingsDialog } from "./SettingsDialog";
import { useVisualViewport } from "./useVisualViewport";
import { useHeaderDiagnostics } from "./useHeaderDiagnostics";

// A navigation adapter keeps the application independently renderable in previews/tests.
export function App({
  navigation: routeNavigation,
}: { navigation?: ReturnType<typeof usePaneNavigation> } = {}) {
  const [localPaneId, setLocalPaneId] = useState<string | null>(null);
  const navigation = routeNavigation ?? {
    paneId: localPaneId,
    sessionId: null,
    view: "chat" as const,
    selectPane: setLocalPaneId,
    selectSession: () => {},
    location: { pathname: "/", searchStr: "" },
  };
  const viewportRef = useVisualViewport();
  useHeaderDiagnostics();
  const singlePane = useSinglePaneLayout();
  const queryClient = useQueryClient();
  const { sessionId, view, selectPane: setSelectedPaneId } = navigation;
  const location = navigation.location;
  const sessionQuery = useQuery({
    queryKey: ["session", sessionId],
    queryFn: () => getSession(sessionId!),
    enabled: Boolean(sessionId),
    refetchInterval: 2_000,
  });
  const selectedPaneId = navigation.paneId ?? sessionQuery.data?.agent?.pane_id ?? null;
  const [resumeOpen, setResumeOpen] = useState(false);
  const [resumeError, setResumeError] = useState("");
  const [resuming, setResuming] = useState(false);
  const [createDialog, setCreateDialog] = useState<{ workspaceId?: string } | null>(null);
  const [workspaceDialogOpen, setWorkspaceDialogOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tabDialogOpen, setTabDialogOpen] = useState(false);
  const agentsQuery = useQuery({
    queryKey: ["agents"],
    queryFn: getAgents,
    refetchInterval: 2_000,
  });

  // Refetching without cached data resets the query to pending and clears its error.
  // Keep the last connection failure visible while automatic retries run.
  const [lastConnectionError, setLastConnectionError] = useState<Error | null>(null);
  useEffect(() => {
    if (agentsQuery.data) setLastConnectionError(null);
    else if (agentsQuery.error) setLastConnectionError(agentsQuery.error);
  }, [agentsQuery.data, agentsQuery.error]);
  const connectionError = agentsQuery.data ? null : (agentsQuery.error ?? lastConnectionError);

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
  const selectedAgent = sessionId
    ? (sessionQuery.data?.agent ?? null)
    : (agents.find((agent) => agent.pane_id === selectedPaneId) ?? null);
  const selectedTab = sessionId
    ? null
    : (tabs.find((tab) => tab.pane_id === selectedPaneId) ?? null);
  const detailOpen = selectedAgent || selectedTab || sessionId || navigation.paneId;

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

      {sessionQuery.isError && sessionQuery.data?.agent && (
        <div className={appStyles["read-error"]} role="status">
          <p>Could not refresh this conversation. Your draft is retained.</p>
          <button type="button" onClick={() => void sessionQuery.refetch()}>
            Try again
          </button>
        </div>
      )}
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

      {connectionError ? (
        <div className={appStyles["page-state"]} data-testid="page-state" role="alert">
          <StateIcon kind="unavailable" />
          <h1>Cannot reach Herdr</h1>
          <p>{connectionError.message}</p>
          <button
            type="button"
            onClick={() => {
              setLastConnectionError(null);
              void agentsQuery.refetch();
            }}
          >
            Try again
          </button>
        </div>
      ) : agentsQuery.isPending && agentsQuery.isPaused ? (
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
      ) : (
        <div className={appStyles["workspace"]}>
          <AgentList
            onOpenSettings={() => setSettingsOpen(true)}
            onOpenSession={(id) => navigation.selectSession(id, "chat", location.pathname !== "/")}
            agents={agents}
            connected={!agentsQuery.isError && !agentsQuery.isPaused}
            tabs={tabs}
            onCreate={(workspaceId) => setCreateDialog({ workspaceId })}
            onCreateTab={() => setTabDialogOpen(true)}
            onCreateWorkspace={() => setWorkspaceDialogOpen(true)}
            selectedPaneId={selectedPaneId}
            workspaces={workspaces}
            onSelect={(agent: Agent) => setSelectedPaneId(agent.pane_id, agent.agent !== "pi")}
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
            onSelectTab={(tab: ShellTab) => setSelectedPaneId(tab.pane_id, true)}
          />
          {selectedAgent ? (
            <AgentConsole
              key={selectedAgent.pane_id}
              agent={selectedAgent}
              expectedSessionId={sessionId ?? undefined}
              routeView={routeNavigation ? view : undefined}
              onSession={
                routeNavigation
                  ? (id) => {
                      if (!sessionId) {
                        queryClient.setQueryData(["session", id], {
                          agent: selectedAgent,
                          chat: null,
                        });
                        navigation.selectSession(
                          id,
                          view === "terminal" ? "terminal" : "chat",
                          true,
                        );
                      }
                    }
                  : undefined
              }
              onViewChange={
                routeNavigation
                  ? (next, id) => {
                      if (id) navigation.selectSession(id, next);
                      else setSelectedPaneId(selectedAgent.pane_id, next === "terminal");
                    }
                  : undefined
              }
              onBack={() => setSelectedPaneId(null)}
            />
          ) : selectedTab ? (
            <ShellConsole tab={selectedTab} onBack={() => setSelectedPaneId(null)} />
          ) : sessionId || navigation.paneId ? (
            <main className={appStyles["console-empty"]} id="main-content">
              <h2>
                {sessionId && sessionQuery.isPending
                  ? "Loading conversation…"
                  : sessionQuery.isError
                    ? "Cannot open conversation"
                    : sessionQuery.data?.chat
                      ? "This conversation is inactive"
                      : "Conversation or pane unavailable"}
              </h2>
              <p>
                {sessionQuery.error?.message ??
                  (sessionQuery.data?.chat
                    ? sessionQuery.data.chat.title
                    : "It may have closed or been removed.")}
              </p>
              {sessionQuery.isError && (
                <button type="button" onClick={() => void sessionQuery.refetch()}>
                  Try again
                </button>
              )}
              {sessionQuery.data?.chat && (
                <button
                  type="button"
                  onClick={() => {
                    setResumeError("");
                    setResumeOpen(true);
                  }}
                >
                  Resume conversation
                </button>
              )}
              <button type="button" onClick={() => setSelectedPaneId(null)}>
                Back to overview
              </button>
            </main>
          ) : (
            <main className={appStyles["console-empty"]} id="main-content">
              <FernblickMark className={appStyles["console-empty__mark"]} />
              <h2>Keep your agents in view.</h2>
              <p>Choose an agent to pick up the conversation, or a shell to open its terminal.</p>
            </main>
          )}
        </div>
      )}

      {resumeOpen && sessionQuery.data?.chat && (
        <ResumeChatDialog
          chat={sessionQuery.data.chat}
          workspaces={workspaces}
          pending={resuming}
          error={resumeError || undefined}
          onClose={() => setResumeOpen(false)}
          onConfirm={async (workspaceId) => {
            setResuming(true);
            try {
              const agent = await resumeChat({ id: sessionQuery.data.chat!.id, workspaceId });
              queryClient.setQueryData(["session", sessionId], { ...sessionQuery.data, agent });
              setResumeOpen(false);
              void agentsQuery.refetch();
            } catch (error) {
              setResumeError(
                error instanceof Error ? error.message : "Could not resume conversation.",
              );
            } finally {
              setResuming(false);
            }
          }}
        />
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
