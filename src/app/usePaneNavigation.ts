import { useCallback, useEffect, useState } from "react";
import { readWhiteboardLink } from "../features/whiteboard/boardLink";

function paneFromHistory(state: unknown): string | null {
  if (
    typeof state === "object" &&
    state !== null &&
    "fernblickPaneId" in state &&
    typeof state.fernblickPaneId === "string"
  ) {
    return state.fernblickPaneId;
  }
  return null;
}

export function usePaneNavigation() {
  const [selectedPaneId, setSelectedPaneId] = useState<string | null>(() =>
    typeof window === "undefined"
      ? null
      : (readWhiteboardLink(window.location?.search ?? "")?.pane ??
        paneFromHistory(window.history.state)),
  );

  const [linkedPane] = useState(() =>
    typeof window === "undefined" ? null : readWhiteboardLink(window.location?.search ?? "")?.pane,
  );
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (linkedPane && paneFromHistory(window.history.state) === null) {
      // Give a direct terminal link an overview entry, so Back stays in Fernblick.
      const detailUrl = window.location.href;
      const overview = new URL(detailUrl);
      for (const key of ["pane", "session", "whiteboard"]) overview.searchParams.delete(key);
      window.history.replaceState(window.history.state, "", overview.pathname + overview.search);
      window.history.pushState(
        { ...window.history.state, fernblickPaneId: linkedPane },
        "",
        detailUrl,
      );
    }
    const onPopState = (event: PopStateEvent) => {
      setSelectedPaneId(paneFromHistory(event.state));
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [linkedPane]);

  const navigateToPane = useCallback((paneId: string | null) => {
    if (typeof window !== "undefined") {
      const currentPaneId = paneFromHistory(window.history.state);
      if (paneId === null && currentPaneId !== null) {
        window.history.back();
        return;
      }
      if (paneId !== null && paneId !== currentPaneId) {
        const state = { ...window.history.state, fernblickPaneId: paneId };
        // Keep one detail entry, so switching chats still goes straight back to overview.
        if (currentPaneId === null) {
          window.history.pushState(state, "");
        } else {
          window.history.replaceState(state, "");
        }
      }
    }
    setSelectedPaneId(paneId);
  }, []);

  return [selectedPaneId, navigateToPane] as const;
}
