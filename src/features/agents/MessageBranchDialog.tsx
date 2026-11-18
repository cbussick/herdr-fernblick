import { useEffect, useRef } from "react";
import type { ChatMessage } from "../../../packages/pi-live-chat/protocol";
import styles from "./Dialogs.module.css";

export function MessageBranchDialog({
  message,
  pending,
  disabled,
  error,
  replacesDraft,
  onConfirm,
  onClose,
}: {
  message: ChatMessage;
  pending: boolean;
  disabled: boolean;
  error?: string;
  replacesDraft: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const opener = dialog.ownerDocument.activeElement;
    dialog.showModal();
    cancel.current?.focus();
    return () => {
      dialog.close();
      if (opener instanceof HTMLElement && opener.isConnected)
        opener.focus({ preventScroll: true });
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={styles["confirm-dialog"]}
      aria-labelledby="message-branch-heading"
      aria-describedby="message-branch-description"
      onCancel={(event) => {
        event.preventDefault();
        if (!pending) onClose();
      }}
    >
      <form
        aria-busy={pending}
        onSubmit={(event) => {
          event.preventDefault();
          if (!disabled && !pending) onConfirm();
        }}
      >
        <h2 id="message-branch-heading">Jump back to this point?</h2>
        <p>
          {message.text.slice(0, 240) || "Image attachment"}
          {message.text.length > 240 ? "…" : ""}
        </p>
        <p id="message-branch-description">
          {message.role === "user"
            ? "Your prompt and available images will return to the composer so you can edit and resend them."
            : "Your next prompt will continue the conversation from this reply."}{" "}
          Your existing conversation will remain available in the tree. This won’t undo file changes
          or commands.
        </p>
        {replacesDraft && message.role === "user" ? (
          <p>Your unsent draft and attachments will be replaced by this prompt.</p>
        ) : null}
        {error ? <p role="alert">{error}</p> : null}
        <div className={styles["confirm-dialog__actions"]}>
          <button ref={cancel} type="button" disabled={pending} onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className={styles["confirm-dialog__primary"]}
            disabled={disabled || pending}
          >
            {pending
              ? "Switching…"
              : message.role === "user"
                ? "Edit and branch"
                : "Continue from here"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
