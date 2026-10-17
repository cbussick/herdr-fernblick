import { useEffect, useState, useSyncExternalStore } from "react";
import type { Agent } from "../shared/api/contracts";

function subscribeVisibility(onChange: () => void) {
  if (typeof document === "undefined") return () => {};
  document.addEventListener("visibilitychange", onChange);
  return () => document.removeEventListener("visibilitychange", onChange);
}
function isVisible() {
  return typeof document === "undefined" || document.visibilityState === "visible";
}
function completionId(agent: Agent) {
  // Revisions also change for unrelated pane updates. Prefer the status sequence
  // so polling cannot make the same completed answer unread again.
  return JSON.stringify([agent.agent_session?.value, agent.state_change_seq ?? agent.revision]);
}

/** Browser-local read receipts; never change Herdr's status or the query cache. */
export function useReadAgentStatuses(agents: Agent[], selectedPaneId: string | null): Agent[] {
  const visible = useSyncExternalStore(subscribeVisibility, isVisible, () => false);
  const [readCompletions, setReadCompletions] = useState<Record<string, string>>({});
  const selected = agents.find((agent) => agent.pane_id === selectedPaneId);
  const selectedCompletion = selected?.agent_status === "done" ? completionId(selected) : null;

  useEffect(() => {
    if (!visible || !selectedPaneId || selectedCompletion === null) return;
    setReadCompletions((current) =>
      current[selectedPaneId] === selectedCompletion
        ? current
        : { ...current, [selectedPaneId]: selectedCompletion },
    );
  }, [visible, selectedPaneId, selectedCompletion]);

  return agents.map((agent) =>
    agent.agent_status === "done" && readCompletions[agent.pane_id] === completionId(agent)
      ? { ...agent, agent_status: "idle" }
      : agent,
  );
}
