import appStyles from "./App.module.css";
import { useEffect, useEffectEvent, useRef, useState } from "react";
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
import { Button } from "../shared/ui";
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
  const { sessionId, view, selectPane: navigateToPane } = navigation;
  const location = navigation.location;
  const [pendingPaneId, setPendingPaneId] = useState<string | null>(null);
  const promotingPaneId = useRef<string | null>(null);
  function setSelectedPaneId(paneId: string | null, terminal = false) {
    setPendingPaneId(null);
    navigateToPane(paneId, terminal);
  }
  useEffect(() => {
    setPendingPaneId(null);
  }, [sessionId, navigation.paneId]);
  const sessionQuery = useQuery({
    queryKey: ["session", sessionId],
    queryFn: () => getSession(sessionId!),
    enabled: Boolean(sessionId),
    refetchInterval: 2_000,
  });
  const selectedPaneId =
    pendingPaneId ?? navigation.paneId ?? sessionQuery.data?.agent?.pane_id ?? null;
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
  const selectedAgent =
    sessionId && !pendingPaneId
      ? (sessionQuery.data?.agent ?? null)
      : (agents.find((agent) => agent.pane_id === selectedPaneId) ?? null);
  const selectedTab =
    sessionId || pendingPaneId
      ? null
      : (tabs.find((tab) => tab.pane_id === selectedPaneId) ?? null);
  const detailOpen = selectedAgent || selectedTab || sessionId || navigation.paneId;

  function openAgent(agent: Agent) {
    if (routeNavigation && agent.agent === "pi" && !agent.pi_session_id) {
      // Fresh Pi sessions are only persisted after the conversation starts.
      // Mount chat now; promote to a session URL once polling finds its saved ID.
      promotingPaneId.current = null;
      setPendingPaneId(agent.pane_id);
      return;
    }
    if (routeNavigation && agent.agent === "pi" && agent.pi_session_id) {
      // Keep the pending console mounted until the new location takes over,
      // otherwise a draft can be lost between scheduling and completing navigation.
      queryClient.setQueryData(
        ["session", agent.pi_session_id],
        (current: Awaited<ReturnType<typeof getSession>> | undefined) => ({
          agent,
          chat: current?.chat ?? null,
        }),
      );
      navigation.selectSession(agent.pi_session_id, "chat", location.pathname !== "/");
    } else {
      setSelectedPaneId(agent.pane_id, agent.agent !== "pi");
    }
  }

  const openPendingAgent = useEffectEvent(openAgent);
  useEffect(() => {
    const ready = agents.find((agent) => agent.pane_id === pendingPaneId && agent.pi_session_id);
    if (ready && promotingPaneId.current !== ready.pane_id) {
      promotingPaneId.current = ready.pane_id;
      openPendingAgent(ready);
    }
  }, [agents, pendingPaneId]);

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

      {pendingPaneId && !selectedAgent && (
        <div className={appStyles["read-error"]} role="status">
          <p>Waiting for this agent’s conversation…</p>
          <button type="button" onClick={() => setSelectedPaneId(pendingPaneId, true)}>
            Open terminal
          </button>
          <button type="button" onClick={() => setPendingPaneId(null)}>
            Cancel
          </button>
        </div>
      )}
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
            onOpenSession={(id) => {
              setPendingPaneId(null);
              navigation.selectSession(id, "chat", location.pathname !== "/");
            }}
            agents={agents}
            connected={!agentsQuery.isError && !agentsQuery.isPaused}
            tabs={tabs}
            onCreate={(workspaceId) => setCreateDialog({ workspaceId })}
            onCreateTab={() => setTabDialogOpen(true)}
            onCreateWorkspace={() => setWorkspaceDialogOpen(true)}
            selectedPaneId={selectedPaneId}
            workspaces={workspaces}
            onSelect={openAgent}
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
              openAgent(agent);
              void agentsQuery.refetch();
            }}
            onSelectTab={(tab: ShellTab) => setSelectedPaneId(tab.pane_id, true)}
          />
          {selectedAgent ? (
            <AgentConsole
              key={selectedAgent.pane_id}
              agent={selectedAgent}
              expectedSessionId={pendingPaneId ? undefined : (sessionId ?? undefined)}
              routeView={routeNavigation ? (pendingPaneId ? "chat" : view) : undefined}
              onSession={
                routeNavigation
                  ? (id) => {
                      if (!sessionId && !pendingPaneId) {
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
              <section
                className={appStyles["conversation-state"]}
                aria-labelledby="conversation-state-title"
              >
                <StateIcon
                  kind={
                    sessionId && sessionQuery.isPending
                      ? "loading"
                      : sessionQuery.isError || !sessionQuery.data?.chat
                        ? "unavailable"
                        : "empty"
                  }
                  spinning={Boolean(sessionId && sessionQuery.isPending)}
                />
                <h2 id="conversation-state-title">
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
                    (sessionId && sessionQuery.isPending
                      ? "Looking for your conversation…"
                      : sessionQuery.data?.chat
                        ? sessionQuery.data.chat.title
                        : "It may have closed or been removed.")}
                </p>
                {sessionQuery.data?.chat && (
                  <p className={appStyles["conversation-state__hint"]}>
                    Resume to continue where you left off.
                  </p>
                )}
                <div className={appStyles["conversation-state__actions"]}>
                  {sessionQuery.isError && (
                    <Button type="button" onClick={() => void sessionQuery.refetch()}>
                      Try again
                    </Button>
                  )}
                  {sessionQuery.data?.chat && (
                    <Button
                      type="button"
                      onClick={() => {
                        setResumeError("");
                        setResumeOpen(true);
                      }}
                    >
                      Resume conversation
                    </Button>
                  )}
                  <Button type="button" variant="secondary" onClick={() => setSelectedPaneId(null)}>
                    Back to overview
                  </Button>
                </div>
              </section>
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
            openAgent(agent);
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
