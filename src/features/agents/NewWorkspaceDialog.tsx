import { useEffect, useRef, useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import type { Workspace } from "../../shared/api/contracts";
import { createWorkspace } from "../../shared/api/apiClient";

interface NewWorkspaceDialogProps {
  onClose: () => void;
  onCreated: (workspace: Workspace) => void;
}

export function NewWorkspaceDialog({ onClose, onCreated }: NewWorkspaceDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [label, setLabel] = useState("");
  const [cwd, setCwd] = useState("");

  const createMutation = useMutation({
    mutationFn: createWorkspace,
    onSuccess: (workspace) => {
      setLabel("");
      setCwd("");
      onCreated(workspace);
      dialogRef.current?.close();
    },
  });

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    createMutation.mutate({ label, cwd });
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
            <h2>New workspace</h2>
            <p>Herdr will create the workspace with an initial shell tab.</p>
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

        <label htmlFor="new-workspace-label">Workspace name</label>
        <input
          id="new-workspace-label"
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          placeholder="My project"
          maxLength={80}
          autoFocus
          required
        />

        <label htmlFor="new-workspace-cwd">Working directory</label>
        <input
          id="new-workspace-cwd"
          value={cwd}
          onChange={(event) => setCwd(event.target.value)}
          placeholder="/srv/my-project"
          maxLength={4_096}
          pattern="/.*"
          aria-describedby="new-workspace-cwd-help"
          required
        />
        <small id="new-workspace-cwd-help">Use an existing absolute path on this VPS.</small>

        {createMutation.isError && <p role="alert">{createMutation.error.message}</p>}

        <div className="new-agent-form__actions">
          <button type="button" onClick={() => dialogRef.current?.close()}>
            Cancel
          </button>
          <button type="submit" disabled={createMutation.isPending}>
            {createMutation.isPending ? "Creating…" : "Create workspace"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
