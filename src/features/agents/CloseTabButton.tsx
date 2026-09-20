import { useRef, useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { closeTab, renameAgent, renameTab, restartAgent } from "../../shared/api/apiClient";
import type { AgentStatus } from "../../shared/api/contracts";
import { PencilIcon, RestartIcon, TrashIcon } from "../../shared/ui/Icons";

interface CloseTabButtonProps {
  agentRunning: boolean;
  agentName?: string | null;
  agentStatus?: AgentStatus;
  agentTarget?: string;
  label: string;
  onClosed: () => void;
  tabId: string;
}
const agentNamePattern = /^[a-z][a-z0-9_-]{0,31}$/;
export function CloseTabButton({
  agentRunning,
  agentName,
  agentStatus,
  agentTarget,
  label,
  onClosed,
  tabId,
}: CloseTabButtonProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const queryClient = useQueryClient();
  const [tabLabel, setTabLabel] = useState(label);
  const [nextAgentName, setNextAgentName] = useState(agentName ?? "");
  const [confirmation, setConfirmation] = useState<"delete" | "restart" | null>(null);
  const saveMutation = useMutation({
    mutationFn: async () => {
      const updates: Promise<void>[] = [];
      if (tabLabel.trim() !== label) updates.push(renameTab(tabId, tabLabel));
      if (agentRunning && agentTarget && nextAgentName && nextAgentName !== agentName)
        updates.push(renameAgent(agentTarget, nextAgentName));
      await Promise.all(updates);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["agents"] });
      dialogRef.current?.close();
    },
  });
  const restartMutation = useMutation({
    mutationFn: () => restartAgent(agentTarget!),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["agents"] });
      void queryClient.invalidateQueries({ queryKey: ["agent-output", agentTarget] });
      void queryClient.invalidateQueries({ queryKey: ["agent-transcript", agentTarget] });
      void queryClient.invalidateQueries({ queryKey: ["agent-tree", agentTarget] });
      dialogRef.current?.close();
    },
  });
  const closeMutation = useMutation({
    mutationFn: () => closeTab(tabId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["agents"] });
      onClosed();
    },
  });
  function open() {
    setTabLabel(label);
    setNextAgentName(agentName ?? "");
    setConfirmation(null);
    saveMutation.reset();
    restartMutation.reset();
    closeMutation.reset();
    dialogRef.current?.showModal();
  }
  function save(event: FormEvent) {
    event.preventDefault();
    saveMutation.mutate();
  }
  const validAgentName = !agentRunning || !nextAgentName || agentNamePattern.test(nextAgentName);
  return (
    <>
      <button
        type="button"
        className="edit-tab-button"
        aria-label={`Edit ${label}`}
        title="Edit tab"
        onClick={open}
      >
        <PencilIcon />
      </button>
      <dialog
        ref={dialogRef}
        className="edit-tab-dialog"
        onClose={() => {
          setConfirmation(null);
          saveMutation.reset();
          restartMutation.reset();
          closeMutation.reset();
        }}
      >
        {confirmation === "delete" ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              closeMutation.mutate();
            }}
          >
            <div className="edit-tab-dialog__icon edit-tab-dialog__icon--danger">
              <TrashIcon />
            </div>
            <h2>Close “{label}”?</h2>
            <p>
              {agentRunning
                ? "The running agent and its terminal session will end."
                : "The terminal session in this tab will end."}
            </p>
            {closeMutation.isError ? <p role="alert">{closeMutation.error.message}</p> : null}
            <div className="edit-tab-dialog__actions">
              <button type="button" onClick={() => setConfirmation(null)}>
                Back
              </button>
              <button
                type="submit"
                className="edit-tab-dialog__danger"
                disabled={closeMutation.isPending}
              >
                {closeMutation.isPending ? "Closing…" : "Close tab"}
              </button>
            </div>
          </form>
        ) : confirmation === "restart" ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              restartMutation.mutate();
            }}
          >
            <div className="edit-tab-dialog__icon">
              <RestartIcon />
            </div>
            <h2>Restart this agent session?</h2>
            <p>
              Pi will close and reopen in the same terminal with this conversation and its branches
              preserved.
            </p>
            {restartMutation.isError ? <p role="alert">{restartMutation.error.message}</p> : null}
            <div className="edit-tab-dialog__actions">
              <button type="button" onClick={() => setConfirmation(null)}>
                Back
              </button>
              <button type="submit" disabled={restartMutation.isPending}>
                {restartMutation.isPending ? "Restarting…" : "Restart session"}
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={save}>
            <div>
              <h2>Edit tab</h2>
              <p>Change how this tab appears in Herdr.</p>
            </div>
            {agentRunning ? (
              <label>
                Agent name
                <input
                  value={nextAgentName}
                  onChange={(event) => setNextAgentName(event.target.value)}
                  placeholder="agent-name"
                  pattern="[a-z][a-z0-9_-]{0,31}"
                  maxLength={32}
                />
                <small>Lowercase letters, numbers, dashes, and underscores.</small>
              </label>
            ) : null}
            <label>
              Tab name
              <input
                autoFocus
                value={tabLabel}
                onChange={(event) => setTabLabel(event.target.value)}
                maxLength={80}
                required
              />
            </label>
            {saveMutation.isError ? <p role="alert">{saveMutation.error.message}</p> : null}
            {agentRunning && agentTarget ? (
              <button
                type="button"
                className="edit-restart-button"
                disabled={agentStatus !== "idle" && agentStatus !== "done"}
                title={
                  agentStatus === "idle" || agentStatus === "done"
                    ? "Restart agent session"
                    : "Wait for the agent to finish before restarting"
                }
                onClick={() => setConfirmation("restart")}
              >
                <RestartIcon />
                Restart agent session
              </button>
            ) : null}
            <button
              type="button"
              className="edit-remove-button"
              onClick={() => setConfirmation("delete")}
            >
              <TrashIcon />
              Close this tab
            </button>
            <hr className="edit-dialog-divider" />
            <div className="edit-tab-dialog__actions">
              <button type="button" onClick={() => dialogRef.current?.close()}>
                Cancel
              </button>
              <button
                type="submit"
                disabled={!tabLabel.trim() || !validAgentName || saveMutation.isPending}
              >
                {saveMutation.isPending ? "Saving…" : "Save changes"}
              </button>
            </div>
          </form>
        )}
      </dialog>
    </>
  );
}
