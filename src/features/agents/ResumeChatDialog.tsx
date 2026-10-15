import { useEffect, useRef, useState, type FormEvent } from "react";
import type { SavedChat, Workspace } from "../../shared/api/contracts";
import styles from "./Dialogs.module.css";

export function ResumeChatDialog({
  chat,
  workspaces,
  pending,
  error,
  onConfirm,
  onClose,
  onCreateWorkspace,
}: {
  chat: SavedChat;
  workspaces: Workspace[];
  pending: boolean;
  error?: string;
  onConfirm: (workspaceId: string) => void;
  onClose: () => void;
  onCreateWorkspace: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const selectRef = useRef<HTMLSelectElement>(null);
  const createWorkspaceRef = useRef<HTMLButtonElement>(null);
  const [workspaceId, setWorkspaceId] = useState(workspaces[0]?.workspace_id ?? "");
  const selectedWorkspace = workspaces.some((workspace) => workspace.workspace_id === workspaceId)
    ? workspaceId
    : (workspaces[0]?.workspace_id ?? "");

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const opener = dialog.ownerDocument?.activeElement;
    if (!dialog.open) dialog.showModal();
    (selectRef.current ?? createWorkspaceRef.current)?.focus();
    return () => {
      if (dialog.open) dialog.close();
      if (opener && opener instanceof HTMLElement && opener.isConnected)
        opener.focus({ preventScroll: true });
    };
  }, []);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || !selectedWorkspace) return;
    onConfirm(selectedWorkspace);
  }

  return (
    <dialog
      ref={dialogRef}
      className={styles["new-agent-dialog"]}
      data-testid="resume-chat-dialog"
      aria-labelledby="resume-chat-heading"
      aria-describedby="resume-chat-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!pending) onClose();
      }}
      onClose={(event) => {
        if (!event.currentTarget.open && !pending) onClose();
      }}
    >
      <form className={styles["new-agent-form"]} onSubmit={submit} aria-busy={pending}>
        <div className={styles["new-agent-form__header"]}>
          <div>
            <h2 id="resume-chat-heading">Open in which workspace?</h2>
            <p id="resume-chat-title">{chat.title}</p>
          </div>
          <button
            type="button"
            className={styles["new-agent-form__close"]}
            aria-label="Close"
            disabled={pending}
            onClick={onClose}
          >
            ×
          </button>
        </div>
        {workspaces.length ? (
          <>
            <label htmlFor="resume-chat-workspace">Workspace</label>
            <select
              ref={selectRef}
              id="resume-chat-workspace"
              value={selectedWorkspace}
              required
              disabled={pending}
              onChange={(event) => setWorkspaceId(event.target.value)}
            >
              {workspaces.map((workspace) => (
                <option key={workspace.workspace_id} value={workspace.workspace_id}>
                  {workspace.label}
                </option>
              ))}
            </select>
          </>
        ) : (
          <button
            type="button"
            ref={createWorkspaceRef}
            disabled={pending}
            className={styles["new-agent-form__inline-action"]}
            onClick={() => {
              onClose();
              onCreateWorkspace();
            }}
          >
            Create a workspace to resume this chat
          </button>
        )}
        {error && <p role="alert">{error} Check the agent list before retrying.</p>}
        <div className={styles["new-agent-form__actions"]}>
          <button type="button" disabled={pending} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" disabled={pending || !selectedWorkspace}>
            {pending ? "Opening…" : "Resume"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
