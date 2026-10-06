import { useEffect, useId, useRef, useState } from "react";
import { type Target } from "../../../packages/pi-live-chat/protocol";
import { StateNotice } from "../../shared/ui/StateFeedback";
import styles from "./ConversationCompaction.module.css";

interface Props {
  target?: Target;
  enabled: boolean;
  supported: boolean;
  pending: boolean;
  notice?: { text: string; error: boolean };
  onCompact: (target: Target) => void;
}

export function ConversationCompaction({
  target,
  enabled,
  supported,
  pending,
  notice,
  onCompact,
}: Props) {
  const [confirmation, setConfirmation] = useState<Target | null>(null);
  const explanationId = useId();
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
  return (
    <section
      className={styles.compaction}
      data-ui="conversation-compaction"
      aria-label="Conversation compaction"
    >
      {confirmation ? (
        <div className={styles.confirmation}>
          <p id={explanationId} className={styles.explanation}>
            Summarize older conversation context to make room. This does not clear the conversation
            or start a new session. Your draft and images stay unchanged.
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
            <button type="button" onClick={() => setConfirmation(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          disabled={!enabled || pending}
          aria-busy={pending}
          title="Summarize older context. Available when Pi is connected and idle."
          onClick={() => target && setConfirmation(target)}
        >
          {pending ? "Compacting conversation…" : "Compact conversation"}
        </button>
      )}
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
  );
}
