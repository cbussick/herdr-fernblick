import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import type { ChatMessage } from "../../../packages/pi-live-chat/protocol";
import { CloseIcon, ImageIcon, LightbulbIcon } from "../../shared/ui/Icons";
import { StateIcon, StateNotice } from "../../shared/ui/StateFeedback";
import { ChatMessageText } from "./ChatMessageText";
import { annotationHighlights, type Annotation } from "./annotations";
import styles from "./Console.module.css";
import a11yStyles from "../../styles/accessibility.module.css";

export interface ChatTranscriptProps {
  messages: ChatMessage[];
  truncated: boolean;
  agentName: string;
  showThinking: boolean;
  id?: string;
  testId?: string;
  before?: ReactNode;
  after?: ReactNode;
  transcriptRef?: RefObject<HTMLElement | null>;
  annotations?: Annotation[];
  interacting?: boolean;
  onImageOpenChange?: (open: boolean) => void;
}
function ChatAttachment({ url, onOpen }: { url: string; onOpen: () => void }) {
  const [unavailable, setUnavailable] = useState(false);
  if (unavailable)
    return (
      <div
        className={styles["chat-attachment-unavailable"]}
        role="img"
        aria-label="Attachment unavailable"
      >
        <ImageIcon />
        <span>Attachment no longer available</span>
      </div>
    );
  return (
    <button type="button" aria-label="Open attached image" onClick={onOpen}>
      <img src={url} alt="User attachment" loading="lazy" onError={() => setUnavailable(true)} />
    </button>
  );
}

/** The same transcript in chat and whiteboard; its container controls only the layout. */
export function ChatTranscript({
  messages,
  truncated,
  agentName,
  showThinking,
  id,
  testId = "chat-transcript",
  before,
  after,
  transcriptRef,
  annotations = [],
  interacting = false,
  onImageOpenChange,
}: ChatTranscriptProps) {
  const output = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const readerTop = useRef(0);
  const appliedTop = useRef<number | null>(null);
  const [image, setImage] = useState<string | null>(null);
  const lightbox = useRef<HTMLDialogElement>(null);
  const alignScroll = useCallback(() => {
    const element = output.current;
    if (!element || interacting) return;
    element.scrollTop = following.current ? element.scrollHeight : readerTop.current;
    // Ignore our own scroll event, including browser clamping after a resize.
    appliedTop.current = element.scrollTop;
  }, [interacting]);
  // Parent-driven expansion changes geometry even when messages are unchanged.
  useLayoutEffect(alignScroll);
  useEffect(() => {
    if (!output.current || typeof ResizeObserver === "undefined") return;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      // Do not write scroll/layout during observer delivery (notably on WebKit).
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(alignScroll);
    });
    observer.observe(output.current);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [alignScroll]);
  useEffect(() => {
    onImageOpenChange?.(Boolean(image));
    return () => onImageOpenChange?.(false);
  }, [image, onImageOpenChange]);
  useEffect(() => {
    if (image && lightbox.current && !lightbox.current.open) lightbox.current.showModal();
  }, [image]);
  return (
    <>
      <div
        ref={(node) => {
          output.current = node;
          if (transcriptRef) transcriptRef.current = node;
        }}
        id={id}
        className={styles["chat-transcript"]}
        data-ui="chat-transcript"
        data-testid={testId}
        data-empty={!messages.length || undefined}
        aria-label="Conversation history"
        tabIndex={0}
        onLoadCapture={alignScroll}
        onScroll={() => {
          const element = output.current;
          if (!element || element.scrollTop === appliedTop.current) return;
          appliedTop.current = null;
          readerTop.current = element.scrollTop;
          following.current = element.scrollHeight - element.scrollTop - element.clientHeight < 48;
        }}
      >
        {before}
        {truncated ? (
          <StateNotice kind="info">
            Showing a bounded recent transcript; some content is omitted.
          </StateNotice>
        ) : null}
        {messages
          .filter((message) => showThinking || message.role !== "thinking")
          .map((message) =>
            message.role === "status" ? (
              <StateNotice kind="info" key={message.id}>
                {message.text}
              </StateNotice>
            ) : message.role === "thinking" ? (
              <div
                className={styles["chat-thinking"]}
                key={message.id}
                data-message-id={message.id}
              >
                <LightbulbIcon />
                <span className={a11yStyles["sr-only"]}>Thinking: </span>
                <ChatMessageText text={message.text} />
              </div>
            ) : message.role === "tool" ? (
              <details
                className={
                  styles["chat-tool"] + " " + (message.isError ? styles["chat-tool--error"] : "")
                }
                data-testid="chat-tool"
                onToggle={alignScroll}
                data-message-id={message.id}
                key={message.id}
              >
                <summary>{message.toolName ?? "Tool result"}</summary>
                <pre>{message.text}</pre>
              </details>
            ) : (
              <article
                className={
                  styles["chat-message"] +
                  " " +
                  (message.role === "user" ? styles["chat-message--user"] : "")
                }
                key={message.id}
                data-message-id={message.id}
                data-role={message.role}
              >
                <span>{message.role === "user" ? "You" : agentName}</span>
                {message.text ? (
                  <ChatMessageText
                    text={message.text}
                    annotationSource={message.role === "assistant" ? message.id : undefined}
                    annotationFeedback={message.role === "user"}
                    highlights={annotationHighlights(message, annotations)}
                  />
                ) : null}
                {message.attachments?.length ? (
                  <div className={styles["chat-message__attachments"]}>
                    {message.attachments.map((url, index) => (
                      <ChatAttachment key={url + index} url={url} onOpen={() => setImage(url)} />
                    ))}
                  </div>
                ) : null}
              </article>
            ),
          )}
        {!messages.length ? (
          <div className={styles["terminal-state"]}>
            <StateIcon kind="empty" />
            <p>No messages yet.</p>
          </div>
        ) : null}
        {after}
      </div>
      {image
        ? createPortal(
            <dialog
              ref={lightbox}
              data-ui="chat-image-preview"
              className={styles["image-lightbox"]}
              aria-label="Image preview"
              onClose={() => setImage(null)}
              onCancel={(event) => event.stopPropagation()}
              onKeyDown={(event) => {
                if (event.key === "Escape") event.stopPropagation();
              }}
              onClick={(event) => {
                if (event.target === event.currentTarget) event.currentTarget.close();
              }}
            >
              <button
                type="button"
                className={styles["image-lightbox__close"]}
                aria-label="Close image preview"
                onClick={() => lightbox.current?.close()}
              >
                <CloseIcon />
              </button>
              <img src={image} alt="Expanded user attachment" />
            </dialog>,
            document.body,
          )
        : null}
    </>
  );
}
