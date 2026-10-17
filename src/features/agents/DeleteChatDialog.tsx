import { useEffect, useRef, type RefObject } from "react";
import type { SavedChat } from "../../shared/api/contracts";
import styles from "./Dialogs.module.css";

export function DeleteChatDialog({
  chat,
  pending,
  error,
  onConfirm,
  onClose,
  fallbackFocusRef,
}: {
  chat: SavedChat;
  pending: boolean;
  error?: string;
  onConfirm: () => void;
  onClose: () => void;
  fallbackFocusRef: RefObject<HTMLElement | null>;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const opener = dialog.ownerDocument?.activeElement;
    const fallbackFocus = fallbackFocusRef.current;
    if (!dialog.open) dialog.showModal();
    cancelRef.current?.focus();
    return () => {
      if (dialog.open) dialog.close();
      if (opener && opener instanceof HTMLElement && opener.isConnected)
        opener.focus({ preventScroll: true });
      else fallbackFocus?.focus({ preventScroll: true });
    };
  }, [fallbackFocusRef]);

  return (
    <dialog
      ref={dialogRef}
      className={styles["confirm-dialog"]}
      data-testid="delete-chat-dialog"
      aria-labelledby="delete-chat-heading"
      aria-describedby="delete-chat-description"
      onCancel={(event) => {
        event.preventDefault();
        if (!pending) onClose();
      }}
      onClose={(event) => {
        if (!event.currentTarget.open && !pending) onClose();
      }}
    >
      <form
        aria-busy={pending}
        onSubmit={(event) => {
          event.preventDefault();
          if (!pending) onConfirm();
        }}
      >
        <h2 id="delete-chat-heading">Delete chat?</h2>
        <p id="delete-chat-description">
          Permanently delete “{chat.title}” and its whiteboards, saved snapshots and uploads that
          aren’t shared with another chat? Local whiteboard drafts in this browser are also removed.
          Other chats and project files are kept. This cannot be undone.
        </p>
        {error && <p role="alert">{error}</p>}
        <div className={styles["confirm-dialog__actions"]}>
          <button ref={cancelRef} type="button" disabled={pending} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={styles["confirm-dialog__danger"]} disabled={pending}>
            {pending ? "Deleting…" : "Delete chat"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
