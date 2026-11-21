import { useRouter, useRouterState } from "@tanstack/react-router";

export type ConsoleView = "chat" | "terminal" | "whiteboard";
type Destination = { kind: "pane" | "session"; id: string };
export type ChatReturn = Destination & { index: number };

export function usePaneNavigation() {
  const router = useRouter();
  const location = useRouterState({ select: (state) => state.location });
  const match = useRouterState({ select: (state) => state.matches.at(-1) });
  const params = (match?.params ?? {}) as { paneId?: string; sessionId?: string };
  const segment = location.pathname.split("/").filter(Boolean).at(-1);
  const view: ConsoleView | undefined =
    segment === "chat" || segment === "terminal" || segment === "whiteboard" ? segment : undefined;
  const overviewIndex =
    location.pathname === "/" ? location.state.__TSR_index : location.state.fernblickOverviewIndex;

  function selectDetail(destination: Destination, nextView: ConsoleView, replace: boolean) {
    const currentId = destination.kind === "session" ? params.sessionId : params.paneId;
    const sameConversation = currentId === destination.id;
    const back = location.state.fernblickChatReturn;
    const closingBoard = sameConversation && view === "whiteboard" && nextView === "chat";
    if (
      closingBoard &&
      back?.kind === destination.kind &&
      back.id === destination.id &&
      Number.isSafeInteger(back.index) &&
      back.index >= 0 &&
      back.index < location.state.__TSR_index
    ) {
      router.history.go(back.index - location.state.__TSR_index);
      return;
    }
    const chatReturn: ChatReturn | undefined =
      nextView === "whiteboard" && sameConversation && view === "chat" && !replace
        ? { ...destination, index: location.state.__TSR_index }
        : sameConversation && nextView !== "chat"
          ? back
          : undefined;
    const state = { fernblickOverviewIndex: overviewIndex, fernblickChatReturn: chatReturn };
    // A direct or promoted board has no older chat entry to return to. Replace
    // it, rather than reloading with go(0) or adding another chat/board cycle.
    if (destination.kind === "session") {
      void router.navigate({
        to: `/sessions/$sessionId/${nextView}`,
        params: { sessionId: destination.id },
        replace: replace || closingBoard,
        state,
      });
    } else {
      void router.navigate({
        to: `/panes/$paneId/${nextView}`,
        params: { paneId: destination.id },
        replace: replace || closingBoard,
        state,
      });
    }
  }
  function selectPaneView(paneId: string, nextView: ConsoleView = "chat", replace = false) {
    selectDetail({ kind: "pane", id: paneId }, nextView, replace);
  }
  function selectPane(paneId: string | null, terminal = false) {
    if (paneId === null) {
      const delta = overviewIndex === undefined ? 0 : overviewIndex - location.state.__TSR_index;
      if (delta < 0) {
        router.history.go(delta);
      } else {
        void router.navigate({ to: "/", replace: true });
      }
    } else {
      selectPaneView(paneId, terminal ? "terminal" : "chat", location.pathname !== "/");
    }
  }
  function selectSession(sessionId: string, nextView: ConsoleView = "chat", replace = false) {
    selectDetail({ kind: "session", id: sessionId }, nextView, replace);
  }
  return {
    location,
    paneId: params.paneId ?? null,
    sessionId: params.sessionId ?? null,
    view,
    selectPane,
    selectPaneView,
    selectSession,
  };
}
