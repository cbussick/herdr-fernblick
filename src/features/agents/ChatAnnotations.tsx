import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CloseIcon, MessageIcon, PencilIcon, SendIcon, TrashIcon } from "../../shared/ui/Icons";
import a11yStyles from "../../styles/accessibility.module.css";
import { positionAnnotationPopover } from "./annotations";
import type { ChatAnnotations } from "./useChatAnnotations";
import styles from "./ChatAnnotations.module.css";

function useAnchoredOverlay(anchor: () => DOMRect, preferBelow = false) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 12, top: 12 });
  useLayoutEffect(() => {
    function place() {
      const element = ref.current;
      if (!element) return;
      const viewport = window.visualViewport;
      const bounds = {
        left: viewport?.offsetLeft ?? 0,
        top: viewport?.offsetTop ?? 0,
        width: viewport?.width ?? window.innerWidth,
        height: viewport?.height ?? window.innerHeight,
      };
      element.style.maxHeight = `${Math.max(120, bounds.height - 24)}px`;
      setPosition(
        positionAnnotationPopover(anchor(), element.getBoundingClientRect(), bounds, preferBelow),
      );
    }
    place();
    const observer = new ResizeObserver(place);
    if (ref.current) observer.observe(ref.current);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    window.visualViewport?.addEventListener("resize", place);
    window.visualViewport?.addEventListener("scroll", place);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      window.visualViewport?.removeEventListener("resize", place);
      window.visualViewport?.removeEventListener("scroll", place);
    };
  }, [anchor, preferBelow]);
  return { ref, position };
}

export function AnnotationSelectionAction({ annotations }: { annotations: ChatAnnotations }) {
  const { anchor, preferBelow } = annotations.selection!;
  // Native touch Copy/Look Up menus usually sit above the selected passage.
  const { ref, position } = useAnchoredOverlay(anchor, preferBelow);
  return createPortal(
    <div
      ref={ref}
      className={styles["selection-action"]}
      data-ui="annotation-action"
      style={position}
    >
      <button
        type="button"
        className={styles.send}
        aria-keyshortcuts="Alt+Enter"
        title="Comment on selection (Alt+Enter)"
        onMouseDown={(event) => event.preventDefault()}
        onClick={annotations.openSelection}
      >
        <MessageIcon /> Comment
      </button>
    </div>,
    document.body,
  );
}

export function AnnotationTray({
  annotations,
  canSend,
  sending,
  locked,
  blockedReason,
  sendError,
  onSend,
}: {
  annotations: ChatAnnotations;
  canSend: boolean;
  sending: boolean;
  locked: boolean;
  blockedReason: string;
  sendError?: string;
  onSend: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  if (!annotations.entries.length) return null;
  const count = annotations.entries.length;
  const latest = annotations.entries.at(-1)!;
  return (
    <section className={styles.tray} aria-label="Pending annotations" aria-busy={sending}>
      <div className={styles["tray-surface"]}>
        <div className={styles["tray-header"]}>
          <button
            type="button"
            className={styles.review}
            aria-expanded={expanded}
            aria-controls="pending-annotation-list"
            onClick={() => setExpanded(!expanded)}
          >
            <MessageIcon />
            <span>
              {count} pending {count === 1 ? "comment" : "comments"}
              <small>{expanded ? "Hide review" : "Review comments"}</small>
            </span>
          </button>
          <button type="button" className={styles.send} disabled={!canSend} onClick={onSend}>
            <SendIcon /> {sending ? "Sending…" : `Send ${count === 1 ? "comment" : "comments"}`}
          </button>
        </div>
        {expanded ? (
          <ol id="pending-annotation-list" className={styles.list}>
            {annotations.entries.map((entry, index) => (
              <li key={entry.id}>
                <div className={styles.note}>
                  <blockquote>{entry.quote}</blockquote>
                  <p>{entry.comment}</p>
                </div>
                <div className={styles.actions}>
                  <button
                    type="button"
                    aria-label={`Edit comment ${index + 1}`}
                    disabled={locked || annotations.stale || Boolean(annotations.editor)}
                    onClick={(event) => {
                      const button = event.currentTarget;
                      annotations.edit(entry, () => button.getBoundingClientRect());
                    }}
                  >
                    <PencilIcon />
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove comment ${index + 1}`}
                    disabled={locked}
                    onClick={() => annotations.remove(entry.id)}
                  >
                    <TrashIcon />
                  </button>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p className={styles.preview}>
            “{latest.quote}” <span>{latest.comment}</span>
          </p>
        )}
        {annotations.stale ? (
          <div className={styles.warning} role="alert">
            <p>
              The conversation changed. These comments won’t be sent to a different session or path.
            </p>
            <button type="button" disabled={locked} onClick={annotations.clear}>
              Discard old comments
            </button>
          </div>
        ) : blockedReason ? (
          <p className={styles.footnote}>{blockedReason}</p>
        ) : null}
        {sendError ? (
          <p className={styles.warning} role="alert">
            {sendError} Comments retained; check Pi before retrying.
          </p>
        ) : null}
      </div>
    </section>
  );
}

export function AnnotationPopover({ annotations }: { annotations: ChatAnnotations }) {
  const editor = annotations.editor!;
  const { ref: popover, position } = useAnchoredOverlay(editor.anchor);
  const input = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    input.current?.focus({ preventScroll: true });
  }, [editor.source]);
  return createPortal(
    <div
      ref={popover}
      className={styles.popover}
      data-ui="annotation-popover"
      role="dialog"
      aria-label={editor.id ? "Edit comment" : "Comment on passage"}
      style={position}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          annotations.close();
        }
      }}
    >
      <div className={styles["popover-header"]}>
        <strong>{editor.id ? "Edit comment" : "Comment on passage"}</strong>
        <button type="button" aria-label="Cancel comment" onClick={annotations.close}>
          <CloseIcon />
        </button>
      </div>
      <blockquote>{editor.source.quote}</blockquote>
      <label htmlFor="annotation-comment" className={a11yStyles["sr-only"]}>
        Your comment
      </label>
      <textarea
        ref={input}
        id="annotation-comment"
        value={editor.comment}
        rows={3}
        maxLength={32000}
        placeholder="What would you change?"
        onChange={(event) => annotations.setComment(event.target.value)}
        onKeyDown={(event) => {
          if (
            event.key === "Enter" &&
            !event.shiftKey &&
            !event.nativeEvent.isComposing &&
            event.keyCode !== 229
          ) {
            event.preventDefault();
            annotations.save();
          }
        }}
      />
      {annotations.editorStale ? (
        <p className={styles.warning} role="alert">
          The conversation is unavailable or has changed. Reconnect, or close this comment and
          select text in the current conversation.
        </p>
      ) : null}
      {annotations.error ? (
        <p className={styles.warning} role="alert">
          {annotations.error}
        </p>
      ) : null}
      <div className={styles["popover-footer"]}>
        <span>
          Enter to save
          <br />
          Shift + Enter for a new line
        </span>
        <button
          type="button"
          className={styles.send}
          disabled={!editor.comment.trim() || annotations.editorStale}
          onClick={annotations.save}
        >
          {editor.id ? "Save comment" : "Add comment"}
        </button>
      </div>
    </div>,
    document.body,
  );
}
