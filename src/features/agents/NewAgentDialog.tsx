import { useEffect, useRef, useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import type { Agent, Workspace } from "../../shared/api/contracts";
import { createAgent } from "../../shared/api/apiClient";

interface NewAgentDialogProps {
  onClose: () => void;
  onCreated: (agent: Agent) => void;
  onCreateWorkspace: () => void;
  open: boolean;
  workspaces: Workspace[];
}

export function NewAgentDialog({
  onClose,
  onCreated,
  onCreateWorkspace,
  open,
  workspaces,
}: NewAgentDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState("");
  const [tabLabel, setTabLabel] = useState("");
  const [workspaceId, setWorkspaceId] = useState("");
  const selectedWorkspaceId = workspaces.some((workspace) => workspace.workspace_id === workspaceId)
    ? workspaceId
    : (workspaces[0]?.workspace_id ?? "");

  const createMutation = useMutation({
    mutationFn: createAgent,
    onSuccess: (agent) => {
      setName("");
      setTabLabel("");
      onCreated(agent);
      dialogRef.current?.close();
    },
  });

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    createMutation.mutate({ name, tabLabel, workspaceId: selectedWorkspaceId });
  }

  function handleClose() {
    createMutation.reset();
    onClose();
  }

  return (
    <dialog ref={dialogRef} className="new-agent-dialog" onClose={handleClose}>
      <form className="new-agent-form" onSubmit={handleSubmit}>
        <div className="new-agent-form__header">
          <div>
            <h2>New Pi agent</h2>
            <p>Herdr will create a tab and start Pi inside it.</p>
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

        <label htmlFor="new-agent-workspace">Workspace</label>
        <select
          id="new-agent-workspace"
          value={selectedWorkspaceId}
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
        <button
          type="button"
          className="new-agent-form__inline-action"
          onClick={() => {
            dialogRef.current?.close();
            onCreateWorkspace();
          }}
        >
          + Create a new workspace
        </button>

        <label htmlFor="new-agent-name">Agent name</label>
        <input
          id="new-agent-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="fix-auth"
          pattern="[a-z][a-z0-9_-]{0,31}"
          maxLength={32}
          aria-describedby="new-agent-name-help"
          required
        />
        <small id="new-agent-name-help">Lowercase letters, numbers, dashes, and underscores.</small>

        <label htmlFor="new-agent-tab">Tab name</label>
        <input
          id="new-agent-tab"
          value={tabLabel}
          onChange={(event) => setTabLabel(event.target.value)}
          placeholder="Fix authentication"
          maxLength={80}
          required
        />

        {createMutation.isError && <p role="alert">{createMutation.error.message}</p>}

        <div className="new-agent-form__actions">
          <button type="button" onClick={() => dialogRef.current?.close()}>
            Cancel
          </button>
          <button type="submit" disabled={!selectedWorkspaceId || createMutation.isPending}>
            {createMutation.isPending ? "Creating…" : "Create agent"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
