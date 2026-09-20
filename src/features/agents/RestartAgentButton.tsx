import { useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { AgentStatus } from "../../shared/api/contracts";
import { restartAgent } from "../../shared/api/apiClient";
import { RestartIcon } from "../../shared/ui/Icons";

interface RestartAgentButtonProps {
  status: AgentStatus;
  target: string;
}

export function RestartAgentButton({ status, target }: RestartAgentButtonProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const queryClient = useQueryClient();
  const canRestart = status === "idle" || status === "done";
  const mutation = useMutation({
    mutationFn: () => restartAgent(target),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["agents"] });
      void queryClient.invalidateQueries({ queryKey: ["agent-output", target] });
      void queryClient.invalidateQueries({ queryKey: ["agent-transcript", target] });
      void queryClient.invalidateQueries({ queryKey: ["agent-tree", target] });
      dialogRef.current?.close();
    },
  });

  return (
    <>
      <button
        type="button"
        className="restart-agent-button"
        disabled={!canRestart}
        title={
          canRestart ? "Restart agent session" : "Wait for the agent to finish before restarting"
        }
        onClick={() => {
          mutation.reset();
          dialogRef.current?.showModal();
        }}
      >
        <RestartIcon />
        Restart
      </button>
      <dialog ref={dialogRef} className="confirm-dialog" onClose={() => mutation.reset()}>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            mutation.mutate();
          }}
        >
          <div className="confirm-dialog__icon">
            <RestartIcon />
          </div>
          <h2>Restart this agent session?</h2>
          <p>
            Pi will close and reopen in the same terminal with this conversation and its branches
            preserved.
          </p>
          {mutation.isError ? <p role="alert">{mutation.error.message}</p> : null}
          <div className="confirm-dialog__actions">
            <button type="button" onClick={() => dialogRef.current?.close()}>
              Cancel
            </button>
            <button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? "Restarting…" : "Restart session"}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
