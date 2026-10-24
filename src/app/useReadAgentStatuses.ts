import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Agent } from "../shared/api/contracts";
import { ApiError, markAgentRead } from "../shared/api/apiClient";

function subscribeVisibility(onChange: () => void) {
  if (typeof document === "undefined") return () => {};
  document.addEventListener("visibilitychange", onChange);
  return () => document.removeEventListener("visibilitychange", onChange);
}
function isVisible() {
  return typeof document === "undefined" || document.visibilityState === "visible";
}
function staleCompletion(error: unknown) {
  return error instanceof ApiError && (error.status === 404 || error.status === 409);
}

/** Persist Fernblick receipts without changing Herdr's status or the raw query cache. */
export function useReadAgentStatuses(agents: Agent[], selectedPaneId: string | null) {
  const visible = useSyncExternalStore(subscribeVisibility, isVisible, () => false);
  const queryClient = useQueryClient();
  const attempted = useRef(new Set<string>());
  const [readCompletions, setReadCompletions] = useState<Set<string>>(() => new Set());
  const mutation = useMutation({
    mutationFn: markAgentRead,
    onSuccess: (_, input) => {
      // Keep successful receipts across polls that were started before the write.
      setReadCompletions((current) => new Set(current).add(input.completionId));
    },
    onError: (error, input) => {
      // A failed write may be retried when this answer is opened again. Removing
      // the guard alone does not retrigger the effect on a mutation rerender.
      attempted.current.delete(input.completionId);
      if (staleCompletion(error)) void queryClient.invalidateQueries({ queryKey: ["agents"] });
    },
  });
  const selected = agents.find((agent) => agent.pane_id === selectedPaneId);
  const completion = selected?.agent_status === "done" ? selected.completion : undefined;
  const completionId = completion?.id;
  const alreadyRead = completion?.read || (completionId && readCompletions.has(completionId));
  const { mutate } = mutation;

  useEffect(() => {
    if (
      !visible ||
      !selectedPaneId ||
      !completionId ||
      alreadyRead ||
      attempted.current.has(completionId)
    )
      return;
    attempted.current.add(completionId);
    mutate({ paneId: selectedPaneId, completionId });
  }, [visible, selectedPaneId, completionId, alreadyRead, mutate]);

  return {
    agents: agents.map((agent) =>
      agent.agent_status === "done" &&
      agent.completion &&
      (agent.completion.read || readCompletions.has(agent.completion.id))
        ? { ...agent, agent_status: "idle" as const }
        : agent,
    ),
    error: mutation.error && !staleCompletion(mutation.error) ? mutation.error : null,
    // Clear only the warning; the receipt remains unread and can be retried on reopening.
    dismissError: mutation.reset,
    retry: () => {
      if (mutation.variables) mutate(mutation.variables);
    },
  };
}
