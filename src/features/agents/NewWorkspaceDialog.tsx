import dialogStyles from "./Dialogs.module.css";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import type { Workspace } from "../../shared/api/contracts";
import { createWorkspace } from "../../shared/api/apiClient";

interface NewWorkspaceDialogProps {
  onClose: () => void;
  onCreated: (workspace: Workspace) => void;
  initialCwd?: string;
  initialLabel?: string;
}

export function NewWorkspaceDialog({
  onClose,
  onCreated,
  initialCwd = "",
  initialLabel = "",
}: NewWorkspaceDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const [label, setLabel] = useState(initialLabel);
  const [cwd, setCwd] = useState(initialCwd);

  const createMutation = useMutation({
    mutationFn: createWorkspace,
    onSuccess: onCreated,
  });

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const opener = dialog.ownerDocument?.activeElement;
    if (!dialog.open) dialog.showModal();
    nameRef.current?.focus();
    return () => {
      if (dialog.open) dialog.close();
      if (opener && opener instanceof HTMLElement && opener.isConnected)
        opener.focus({ preventScroll: true });
    };
  }, []);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!createMutation.isPending) createMutation.mutate({ label, cwd });
  }

  function handleClose() {
    if (!createMutation.isPending) onClose();
  }

  return (
    <dialog
      ref={dialogRef}
      className={dialogStyles["new-agent-dialog"]}
      aria-labelledby="new-workspace-heading"
      onCancel={(event) => {
        event.preventDefault();
        handleClose();
      }}
      onClose={(event) => {
        if (!event.currentTarget.open) handleClose();
      }}
    >
      <form
        className={dialogStyles["new-agent-form"]}
        onSubmit={handleSubmit}
        aria-busy={createMutation.isPending}
      >
        <div className={dialogStyles["new-agent-form__header"]}>
          <div>
            <h2 id="new-workspace-heading">New workspace</h2>
            <p>Herdr will create the workspace with an initial shell tab.</p>
          </div>
          <button
            type="button"
            className={dialogStyles["new-agent-form__close"]}
            onClick={handleClose}
            disabled={createMutation.isPending}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <label htmlFor="new-workspace-label">Workspace name</label>
        <input
          ref={nameRef}
          id="new-workspace-label"
          value={label}
          disabled={createMutation.isPending}
          onChange={(event) => setLabel(event.target.value)}
          placeholder="My project"
          maxLength={80}
          required
        />

        <label htmlFor="new-workspace-cwd">Working directory</label>
        <input
          id="new-workspace-cwd"
          value={cwd}
          disabled={createMutation.isPending}
          onChange={(event) => setCwd(event.target.value)}
          placeholder="/srv/my-project"
          maxLength={4_096}
          pattern="/.*"
          aria-describedby="new-workspace-cwd-help"
          required
        />
        <small id="new-workspace-cwd-help">Use an existing absolute path on this VPS.</small>

        {createMutation.isError && <p role="alert">{createMutation.error.message}</p>}

        <div className={dialogStyles["new-agent-form__actions"]}>
          <button type="button" disabled={createMutation.isPending} onClick={handleClose}>
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
