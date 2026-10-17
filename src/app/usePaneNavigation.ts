import { useCallback, useEffect, useState } from "react";

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
    typeof window === "undefined" ? null : paneFromHistory(window.history.state),
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onPopState = (event: PopStateEvent) => {
      setSelectedPaneId(paneFromHistory(event.state));
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

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
