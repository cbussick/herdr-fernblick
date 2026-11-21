import appStyles from "./App.module.css";
import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from "react";
import { ResumeChatDialog } from "../features/agents/ResumeChatDialog";
import { skipToken, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Agent, ShellTab, Workspace } from "../shared/api/contracts";
import { getAgents, getSession, resumeChat } from "../shared/api/apiClient";
import { AgentList } from "../features/agents/AgentList";
import { PaneConsole } from "../features/agents/PaneConsole";
import { NewAgentDialog } from "../features/agents/NewAgentDialog";
import { NewWorkspaceDialog } from "../features/agents/NewWorkspaceDialog";
import { NewTabDialog } from "../features/agents/NewTabDialog";
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
    selectPaneView: (id: string) => setLocalPaneId(id),
    selectSession: () => {},
    location: { pathname: "/", searchStr: "" },
  };
  const viewportRef = useVisualViewport();
  useHeaderDiagnostics();
  const singlePane = useSinglePaneLayout();
  const queryClient = useQueryClient();
  const { sessionId, view, selectPane: navigateToPane } = navigation;
  const location = navigation.location;
  const locationKey = routeNavigation?.location.state.__TSR_key ?? location.pathname;
  const [retained, setRetained] = useState<{ id: string; agent: Agent } | null>(null);
  const retainedAgent = retained?.id === sessionId ? retained.agent : null;
  function setSelectedPaneId(paneId: string | null, terminal = false) {
    navigateToPane(paneId, terminal);
  }

  const sessionQuery = useQuery({
    queryKey: ["session", sessionId],
    queryFn: sessionId ? () => getSession(sessionId) : skipToken,
    enabled: Boolean(sessionId),
    refetchInterval: 2000,
  });
  const selectedPaneId =
    navigation.paneId ?? sessionQuery.data?.agent?.pane_id ?? retainedAgent?.pane_id ?? null;
  const [resumeOpen, setResumeOpen] = useState(false);
  const [resumeError, setResumeError] = useState("");
  const [resuming, setResuming] = useState(false);
  const [createDialog, setCreateDialog] = useState<{
    workspaceId?: string;
    navigationVersion: number;
  } | null>(null);
  const [workspaceDialogOpen, setWorkspaceDialogOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tabDialogOpen, setTabDialogOpen] = useState<{ navigationVersion: number } | null>(null);
  const agentsQuery = useQuery({
    queryKey: ["agents"],
    queryFn: getAgents,
    refetchInterval: 2000,
  });

  // Refetching without cached data resets the query to pending and clears its error.
  // Keep the last connection failure visible while automatic retries run.
  const [lastConnectionError, setLastConnectionError] = useState<Error | null>(null);
  if (agentsQuery.data && lastConnectionError !== null) {
    setLastConnectionError(null);
  } else if (!agentsQuery.data && agentsQuery.error && lastConnectionError !== agentsQuery.error) {
    setLastConnectionError(agentsQuery.error);
  }
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
  const [observedPiPane, setObservedPiPane] = useState<string | null>(null);
  const observed =
    navigation.paneId && selectedAgent?.agent === "pi"
      ? navigation.paneId
      : observedPiPane === navigation.paneId
        ? observedPiPane
        : null;
  if (observed !== observedPiPane) {
    setObservedPiPane(observed);
  }
  const paneRetired = Boolean(
    navigation.paneId &&
    observedPiPane === navigation.paneId &&
    selectedAgent?.agent !== "pi" &&
    agentsQuery.isSuccess,
  );
  // Keep this conversation's component alive (but suspended) across a successful
  // inactive poll. Never substitute the retained agent as live/command authority.
  if (sessionId && selectedAgent && retainedAgent !== selectedAgent) {
    setRetained({ id: sessionId, agent: selectedAgent });
  } else if (retained && retained.id !== sessionId) {
    setRetained(null);
  }
  const consoleAgent = selectedAgent ?? retainedAgent;
  const [mount, setMount] = useState({ paneId: selectedPaneId, sessionId, version: 0 });
  if (mount.paneId !== selectedPaneId || mount.sessionId !== sessionId) {
    const sameSavedConversation = Boolean(sessionId && mount.sessionId === sessionId);
    const replacement =
      (!sameSavedConversation && mount.paneId !== selectedPaneId) ||
      Boolean(mount.sessionId && mount.sessionId !== sessionId);
    setMount({ paneId: selectedPaneId, sessionId, version: mount.version + Number(replacement) });
  }
  const detailOpen = selectedAgent || selectedTab || sessionId || navigation.paneId;
  // Async completions may update data, but only the initiating flow can navigate.
  // A monotonic version also prevents Back/Forward from reviving an old intent.
  const latest = useRef({
    tabId: null as string | null,
    navigationVersion: 0,
    locationKey,
    createDialog,
    tabDialogOpen,
    back: () => {},
  });
  useLayoutEffect(() => {
    latest.current = {
      tabId: consoleAgent?.tab_id ?? selectedTab?.tab_id ?? null,
      navigationVersion:
        latest.current.navigationVersion + Number(latest.current.locationKey !== locationKey),
      locationKey,
      createDialog,
      tabDialogOpen,
      back: () => setSelectedPaneId(null),
    };
  });

  useLayoutEffect(
    () => () => {
      latest.current = {
        ...latest.current,
        tabId: null,
        createDialog: null,
        tabDialogOpen: null,
        back: () => {},
      };
    },
    [],
  );

  function openAgent(agent: Agent) {
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

  const livePane = useRef<{ paneId: string; sessionId: string } | null>(null);
  useLayoutEffect(() => {
    livePane.current = null;
  }, [navigation.paneId]);
  const reconcilePane = useEffectEvent(() => {
    if (!routeNavigation || !navigation.paneId) {
      return;
    }
    if (paneRetired) {
      setSelectedPaneId(null);
      return;
    }
    const id = selectedAgent?.pi_session_id;
    if (selectedAgent?.agent === "pi" && id) {
      if (livePane.current?.paneId === navigation.paneId && livePane.current.sessionId !== id) {
        return;
      }
      queryClient.setQueryData(["session", id], { agent: selectedAgent, chat: null });
      navigation.selectSession(id, view, true);
    } else if (selectedAgent && selectedAgent.agent !== "pi" && view !== "terminal") {
      navigation.selectPaneView(navigation.paneId, "terminal", true);
    }
  });
  useEffect(() => {
    reconcilePane();
  }, [selectedAgent, selectedTab, paneRetired, navigation.paneId, view]);

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

  const resumableChat = sessionQuery.data?.chat;
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
            navigationKey={locationKey}
            onOpenSettings={() => setSettingsOpen(true)}
            onOpenSession={(id) => {
              navigation.selectSession(id, "chat", location.pathname !== "/");
            }}
            agents={agents}
            connected={!agentsQuery.isError && !agentsQuery.isPaused}
            tabs={tabs}
            onCreate={(workspaceId) =>
              setCreateDialog({ workspaceId, navigationVersion: latest.current.navigationVersion })
            }
            onCreateTab={() =>
              setTabDialogOpen({ navigationVersion: latest.current.navigationVersion })
            }
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
          {!paneRetired && (consoleAgent || selectedTab) && (
            <PaneConsole
              key={mount.version}
              agent={consoleAgent ?? undefined}
              suspended={!selectedAgent && !selectedTab}
              tab={selectedTab}
              expectedSessionId={sessionId ?? undefined}
              routeView={routeNavigation ? view : undefined}
              onSession={
                routeNavigation
                  ? (id) => {
                      if (selectedAgent) {
                        livePane.current = { paneId: selectedAgent.pane_id, sessionId: id };
                      }
                    }
                  : undefined
              }
              onViewChange={
                routeNavigation
                  ? (next) => {
                      if (sessionId) {
                        navigation.selectSession(sessionId, next);
                      } else if (selectedPaneId) {
                        navigation.selectPaneView(selectedPaneId, next);
                      }
                    }
                  : undefined
              }
              onBack={() => {
                const tabId = consoleAgent?.tab_id ?? selectedTab?.tab_id;
                if (latest.current.tabId === tabId) {
                  latest.current.back();
                }
              }}
            />
          )}
          {paneRetired || (!selectedAgent && !selectedTab) ? (
            sessionId || navigation.paneId ? (
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
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => setSelectedPaneId(null)}
                    >
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
            )
          ) : null}
        </div>
      )}

      {resumeOpen && resumableChat && (
        <ResumeChatDialog
          chat={resumableChat}
          workspaces={workspaces}
          pending={resuming}
          error={resumeError || undefined}
          onClose={() => setResumeOpen(false)}
          onConfirm={(workspaceId) => {
            void (async () => {
              setResuming(true);
              try {
                const agent = await resumeChat({ id: resumableChat.id, workspaceId });
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
            })();
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
            if (latest.current.createDialog === createDialog) {
              if (latest.current.navigationVersion === createDialog.navigationVersion) {
                openAgent(agent);
              }
              setCreateDialog(null);
            }
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
          onClose={() => setTabDialogOpen(null)}
          onCreated={(tab) => {
            queryClient.setQueryData(
              ["agents"],
              (current: Awaited<ReturnType<typeof getAgents>> | undefined) =>
                current
                  ? {
                      ...current,
                      tabs: [...current.tabs.filter((item) => item.pane_id !== tab.pane_id), tab],
                    }
                  : current,
            );
            if (latest.current.tabDialogOpen === tabDialogOpen) {
              if (latest.current.navigationVersion === tabDialogOpen.navigationVersion) {
                setSelectedPaneId(tab.pane_id, true);
              }
              setTabDialogOpen(null);
            }
            void agentsQuery.refetch();
          }}
        />
      )}
    </div>
  );
}
