import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { type Target } from "../../../packages/pi-live-chat/protocol";
import { CompactIcon, LoaderIcon } from "../../shared/ui/Icons";
import { StateNotice } from "../../shared/ui/StateFeedback";
import styles from "./ConversationCompaction.module.css";

interface Props {
  target?: Target;
  enabled: boolean;
  supported: boolean;
  pending: boolean;
  notice?: { text: string; error: boolean };
  onCompact: (target: Target) => void;
  children: (action: ReactNode) => ReactNode;
}

export function ConversationCompaction({
  target,
  enabled,
  supported,
  pending,
  notice,
  onCompact,
  children,
}: Props) {
  const [confirmation, setConfirmation] = useState<Target | null>(null);
  const explanationId = useId();
  const panelId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (confirmation) confirmButton.current?.focus();
  }, [confirmation]);
  // A confirmation belongs to the target that was visible when it opened.
  const sameTarget =
    target &&
    confirmation &&
    target.runtime === confirmation.runtime &&
    target.sessionId === confirmation.sessionId &&
    target.epoch === confirmation.epoch;
  if (confirmation && !sameTarget) setConfirmation(null);
  function cancel() {
    setConfirmation(null);
    trigger.current?.focus();
  }
  const action = (
    <button
      type="button"
      ref={trigger}
      className={styles.trigger}
      data-ui="compact-conversation-button"
      disabled={!enabled || pending}
      aria-label="Compact conversation"
      aria-busy={pending}
      aria-expanded={Boolean(confirmation)}
      aria-controls={confirmation ? panelId : undefined}
      title={
        pending ? "Compacting conversation…" : "Compact conversation — summarize older context"
      }
      onClick={() => {
        if (confirmation) cancel();
        else if (target) setConfirmation(target);
      }}
    >
      {pending ? <LoaderIcon /> : <CompactIcon />}
      <span className={styles.label} aria-hidden="true">
        Compact
      </span>
    </button>
  );
  return (
    <>
      {children(action)}
      {confirmation || !supported || pending || notice ? (
        <section
          id={panelId}
          className={styles.compaction}
          data-ui="conversation-compaction"
          aria-label="Conversation compaction"
          onKeyDown={(event) => {
            if (confirmation && event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              cancel();
            }
          }}
        >
          {confirmation ? (
            <div className={styles.confirmation}>
              <p id={explanationId} className={styles.explanation}>
                Summarize older conversation context to make room. This does not clear the
                conversation or start a new session. Your draft and images stay unchanged.
              </p>
              <div className={styles.actions}>
                <button
                  type="button"
                  ref={confirmButton}
                  disabled={!enabled || pending}
                  aria-describedby={explanationId}
                  onClick={() => {
                    onCompact(confirmation);
                    setConfirmation(null);
                  }}
                >
                  Compact now
                </button>
                <button type="button" onClick={cancel}>
                  Cancel
                </button>
              </div>
            </div>
          ) : null}
          {!supported ? (
            <p className={styles.explanation}>Run /reload in Pi to enable compaction.</p>
          ) : null}
          {pending && !notice ? (
            <p role="status" className={styles.explanation}>
              Summarizing older context; waiting for Pi to finish…
            </p>
          ) : null}
          {notice ? (
            <StateNotice
              kind={notice.error ? "unavailable" : "info"}
              role={notice.error ? "alert" : "status"}
            >
              {notice.text}
            </StateNotice>
          ) : null}
        </section>
      ) : null}
    </>
  );
}
