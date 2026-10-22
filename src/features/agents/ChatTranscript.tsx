import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import type { ChatMessage } from "../../../packages/pi-live-chat/protocol";
import { ImageIcon, LightbulbIcon } from "../../shared/ui/Icons";
import { StateIcon, StateNotice } from "../../shared/ui/StateFeedback";
import { ChatMessageText } from "./ChatMessageText";
import { ImageLightbox } from "./ImageLightbox";
import { annotationHighlights, type Annotation, type AnnotationEditHandler } from "./annotations";
import styles from "./Console.module.css";
import a11yStyles from "../../styles/accessibility.module.css";

export interface ChatTranscriptProps {
  messages: ChatMessage[];
  truncated: boolean;
  agentName: string;
  showThinking: boolean;
  cwd?: string;
  id?: string;
  testId?: string;
  before?: ReactNode;
  after?: ReactNode;
  transcriptRef?: RefObject<HTMLElement | null>;
  annotations?: Annotation[];
  onAnnotationEdit?: AnnotationEditHandler;
  interacting?: boolean;
  /** Increment for an explicit local send, never for streaming or snapshot updates. */
  followRequest?: number;
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
  cwd,
  id,
  testId = "chat-transcript",
  before,
  after,
  transcriptRef,
  annotations = [],
  onAnnotationEdit,
  interacting = false,
  followRequest = 0,
  onImageOpenChange,
}: ChatTranscriptProps) {
  const output = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const readerTop = useRef(0);
  const appliedTop = useRef<number | null>(null);
  const lastFollowRequest = useRef(followRequest);
  const touchY = useRef<number | null>(null);
  const [image, setImage] = useState<{ urls: string[]; index: number } | null>(null);
  const imageOpen = Boolean(image);
  const alignScroll = useCallback(() => {
    const element = output.current;
    if (!element || interacting) return;
    element.scrollTop = following.current ? element.scrollHeight : readerTop.current;
    // Ignore our own scroll event, including browser clamping after a resize.
    appliedTop.current = element.scrollTop;
  }, [interacting]);
  // Parent-driven expansion changes geometry even when messages are unchanged.
  useLayoutEffect(() => {
    if (followRequest !== lastFollowRequest.current) {
      lastFollowRequest.current = followRequest;
      following.current = true;
    }
    alignScroll();
  });
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
    onImageOpenChange?.(imageOpen);
    return () => onImageOpenChange?.(false);
  }, [imageOpen, onImageOpenChange]);
  function pauseFollowing() {
    const element = output.current;
    if (!element || !following.current) return;
    following.current = false;
    readerTop.current = element.scrollTop;
    appliedTop.current = null;
  }
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
        onWheel={(event) => {
          if (event.deltaY < 0) pauseFollowing();
        }}
        onTouchStart={(event) => {
          touchY.current = event.touches[0]?.clientY ?? null;
        }}
        onTouchMove={(event) => {
          const nextY = event.touches[0]?.clientY ?? null;
          if (nextY !== null && touchY.current !== null && nextY > touchY.current) pauseFollowing();
          touchY.current = nextY;
        }}
        onPointerDown={(event) => {
          if (event.pointerType !== "mouse" || event.button !== 0) return;
          const element = event.currentTarget;
          const left = element.getBoundingClientRect().left;
          // Native scrollbar interaction, including a left-side RTL scrollbar.
          if (
            event.clientX >= left + element.clientLeft + element.clientWidth ||
            event.clientX < left + element.clientLeft
          )
            pauseFollowing();
        }}
        onKeyDown={(event) => {
          if (
            ["ArrowUp", "PageUp", "Home"].includes(event.key) ||
            (event.key === " " && event.shiftKey && event.target === event.currentTarget)
          )
            pauseFollowing();
        }}
        onScroll={() => {
          const element = output.current;
          if (!element) return;
          // Browser layout/keyboard clamping can move scrollTop several times
          // before this event. Only reader input should leave follow mode.
          if (following.current) {
            alignScroll();
            return;
          }
          const maxTop = Math.max(0, element.scrollHeight - element.clientHeight);
          // Geometry can clamp our last write before the resize callback runs.
          // That automatic movement is not the reader scrolling upward.
          if (
            appliedTop.current !== null &&
            (element.scrollTop === appliedTop.current ||
              element.scrollTop === Math.min(appliedTop.current, maxTop))
          )
            return;
          const previousTop = appliedTop.current ?? readerTop.current;
          appliedTop.current = null;
          readerTop.current = element.scrollTop;
          // Any upward movement pauses following, even within bottom rounding tolerance.
          // Resume only when the reader scrolls back down to the bottom.
          following.current =
            element.scrollTop >= previousTop &&
            element.scrollHeight - element.scrollTop - element.clientHeight <= 1;
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
                <ChatMessageText text={message.text} cwd={cwd} />
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
                    cwd={cwd}
                    annotationSource={message.role === "assistant" ? message.id : undefined}
                    annotationFeedback={message.role === "user"}
                    highlights={annotationHighlights(message, annotations)}
                    onAnnotationEdit={onAnnotationEdit}
                  />
                ) : null}
                {message.attachments?.length ? (
                  <div className={styles["chat-message__attachments"]}>
                    {message.attachments.map((url, index) => (
                      <ChatAttachment
                        key={url + index}
                        url={url}
                        onOpen={() => setImage({ urls: message.attachments!, index })}
                      />
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
      {image ? (
        <ImageLightbox
          images={image.urls.map((url) => ({ url, alt: "Expanded user attachment" }))}
          index={image.index}
          onIndexChange={(index) => setImage((current) => current && { ...current, index })}
          onClose={() => setImage(null)}
        />
      ) : null}
    </>
  );
}
