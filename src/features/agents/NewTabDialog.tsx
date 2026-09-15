import { useEffect, useRef, useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import type { ShellTab, Workspace } from "../../shared/api/contracts";
import { createTab } from "../../shared/api/apiClient";

interface NewTabDialogProps {
  onClose: () => void;
  onCreated: (tab: ShellTab) => void;
  workspaces: Workspace[];
}

export function NewTabDialog({ onClose, onCreated, workspaces }: NewTabDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [label, setLabel] = useState("");
  const [workspaceId, setWorkspaceId] = useState(workspaces[0]?.workspace_id ?? "");
  const createMutation = useMutation({
    mutationFn: createTab,
    onSuccess: (tab) => {
      onCreated(tab);
      dialogRef.current?.close();
    },
  });

  useEffect(() => dialogRef.current?.showModal(), []);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    createMutation.mutate({ label, workspaceId });
  }

  return (
    <dialog
      ref={dialogRef}
      className="new-agent-dialog"
      onClose={() => {
        createMutation.reset();
        onClose();
      }}
    >
      <form className="new-agent-form" onSubmit={handleSubmit}>
        <div className="new-agent-form__header">
          <div>
            <h2>New shell tab</h2>
            <p>Open a regular terminal tab without starting an agent.</p>
          </div>
          <button
            type="button"
            className="new-agent-form__close"
            onClick={() => dialogRef.current?.close()}
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <label htmlFor="new-tab-workspace">Workspace</label>
        <select
          id="new-tab-workspace"
          value={workspaceId}
          onChange={(event) => setWorkspaceId(event.target.value)}
          required
          autoFocus
        >
          {workspaces.map((workspace) => (
            <option key={workspace.workspace_id} value={workspace.workspace_id}>
              {workspace.label}
            </option>
          ))}
        </select>
        <label htmlFor="new-tab-label">Tab name</label>
        <input
          id="new-tab-label"
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          placeholder="Server logs"
          maxLength={80}
          required
        />
        {createMutation.isError && <p role="alert">{createMutation.error.message}</p>}
        <div className="new-agent-form__actions">
          <button type="button" onClick={() => dialogRef.current?.close()}>
            Cancel
          </button>
          <button type="submit" disabled={!workspaceId || createMutation.isPending}>
            {createMutation.isPending ? "Creating…" : "Create tab"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
