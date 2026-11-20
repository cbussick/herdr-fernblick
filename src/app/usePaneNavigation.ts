import { useRouter, useRouterState } from "@tanstack/react-router";

export type ConsoleView = "chat" | "terminal" | "whiteboard";

export function usePaneNavigation() {
  const router = useRouter();
  const location = useRouterState({ select: (state) => state.location });
  const match = useRouterState({ select: (state) => state.matches.at(-1) });
  const params = (match?.params ?? {}) as { paneId?: string; sessionId?: string };
  const view = location.pathname.split("/").filter(Boolean).at(-1) as ConsoleView;
  const overviewIndex =
    location.pathname === "/" ? location.state.__TSR_index : location.state.fernblickOverviewIndex;

  function selectPane(paneId: string | null, terminal = false) {
    if (paneId === null) {
      const delta = overviewIndex === undefined ? 0 : overviewIndex - location.state.__TSR_index;
      if (delta < 0) {
        router.history.go(delta);
      } else {
        void router.navigate({ to: "/", replace: true });
      }
    } else {
      void router.navigate({
        to: `/panes/$paneId/${terminal ? "terminal" : "chat"}`,
        params: { paneId },
        replace: location.pathname !== "/",
        state: { fernblickOverviewIndex: overviewIndex },
      });
    }
  }
  function selectSession(sessionId: string, nextView: ConsoleView = "chat", replace = false) {
    // Closing a board should restore chat, not add another chat/board cycle.
    if (
      params.sessionId === sessionId &&
      view === "whiteboard" &&
      nextView === "chat" &&
      location.state.fernblickChatIndex !== undefined
    ) {
      router.history.go(location.state.fernblickChatIndex - location.state.__TSR_index);
      return;
    }
    void router.navigate({
      to: `/sessions/$sessionId/${nextView}`,
      params: { sessionId },
      replace,
      state: {
        fernblickOverviewIndex: overviewIndex,
        fernblickChatIndex:
          nextView === "whiteboard" && view === "chat"
            ? location.state.__TSR_index
            : location.state.fernblickChatIndex,
      },
    });
  }
  return {
    location,
    paneId: params.paneId ?? null,
    sessionId: params.sessionId ?? null,
    view,
    selectPane,
    selectSession,
  };
}
