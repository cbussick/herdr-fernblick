import { PanelRightClose, PanelRightOpen, PanelBottomClose, PanelBottomOpen } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import type { Snapshot } from "../../../packages/pi-live-chat/protocol";
import { ChatTranscript } from "../agents/ChatTranscript";
import { StatusIndicator } from "../../shared/ui";
import { useConversationSize } from "./useConversationSize";
import styles from "./ConversationDock.module.css";

/** A view of the existing chat. The console retains ownership of drafts and sends. */
export interface BoardPromptContext {
  boardId: string;
  revision: number;
  text: string;
  uploadId?: string;
}
export interface WhiteboardConversation {
  snapshot?: Pick<Snapshot, "messages" | "truncated"> & {
    status?: Pick<Snapshot["status"], "cwd">;
  };
  showThinking: boolean;
  draft: string;
  sending: boolean;
  followRequest?: number;
  error?: string;
  onDraftChange: (text: string) => void;
  onSend: (board: BoardPromptContext) => void;
}
interface ConversationDockProps {
  conversation: Omit<WhiteboardConversation, "onSend"> & { onSend: () => void };
  disabled: boolean;
  inert: boolean;
  activity: {
    message: string;
    detail?: ReactNode;
    warning: boolean;
    working?: boolean;
    action?: ReactNode;
  };
  recovery?: ReactNode;
}
export function ConversationDock({
  conversation,
  disabled,
  inert,
  activity,
  recovery,
}: ConversationDockProps) {
  const dock = useRef<HTMLElement>(null);
  const size = useConversationSize(dock);
  const { expanded } = size;
  // An unavailable chat frame is not a new conversation. The enclosing board
  // unmounts on confirmed identity replacement, so this cache cannot cross targets.
  const [retained, setRetained] = useState(conversation.snapshot);
  if (conversation.snapshot && conversation.snapshot !== retained)
    setRetained(conversation.snapshot);
  const snapshot = conversation.snapshot ?? retained;
  const messages = snapshot?.messages ?? [];
  const expandButton = useRef<HTMLButtonElement>(null);
  const blocked = disabled || inert || conversation.sending || !conversation.draft.trim();
  function submit() {
    if (!blocked) conversation.onSend();
  }
  return (
    <section
      ref={dock}
      id="whiteboard-conversation-panel"
      className={styles.dock}
      style={size.style}
      data-resizing={size.dragging || undefined}
      data-ui="conversation-dock"
      data-testid="whiteboard-conversation"
      data-expanded={size.fullHeight || undefined}
      aria-label="Whiteboard conversation"
      inert={inert || undefined}
      onKeyDown={(event) => {
        if (
          event.key === "Escape" &&
          expanded &&
          !event.defaultPrevented &&
          !event.nativeEvent.isComposing
        ) {
          event.preventDefault();
          event.stopPropagation();
          size.collapse();
          expandButton.current?.focus();
        }
      }}
    >
      <header
        className={styles.activity}
        data-testid="whiteboard-activity"
        data-warning={activity.warning || undefined}
      >
        <div className={styles["resize-row"]}>
          <button
            ref={expandButton}
            className={styles.toggle}
            title={expanded ? "Collapse conversation" : "Expand conversation"}
            type="button"
            aria-expanded={expanded}
            aria-controls="whiteboard-conversation-messages"
            aria-label={expanded ? "Collapse conversation" : "Expand conversation"}
            onClick={size.toggle}
          >
            <span className={styles["side-icon"]} aria-hidden="true">
              {expanded ? <PanelRightClose size={20} /> : <PanelRightOpen size={20} />}
            </span>
            <span className={styles["bottom-icon"]} aria-hidden="true">
              {expanded ? <PanelBottomClose size={20} /> : <PanelBottomOpen size={20} />}
            </span>
          </button>
          <div
            {...size.separator}
            className={styles.resize}
            data-testid="whiteboard-conversation-resize"
            title="Drag or use arrow keys to resize conversation"
          >
            <span className={styles.grip} aria-hidden="true" />
          </div>
        </div>
        <div className={styles["activity__text"]} role={activity.warning ? "alert" : "status"}>
          <p>
            {activity.working && !activity.warning ? (
              <StatusIndicator status="working" label="Working" />
            ) : (
              activity.message || null
            )}
          </p>
          {activity.detail}
        </div>
        {activity.action}
      </header>
      {recovery}
      <ChatTranscript
        id="whiteboard-conversation-messages"
        testId="whiteboard-replies"
        messages={messages}
        cwd={snapshot?.status?.cwd}
        truncated={snapshot?.truncated ?? false}
        showThinking={conversation.showThinking}
        followRequest={conversation.followRequest}
      />
      <form
        className={styles.composer}
        aria-label="Message from whiteboard"
        aria-busy={conversation.sending}
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <textarea
          aria-label="Message the agent"
          placeholder="Message…"
          title="Enter to send; Shift+Enter for a new line"
          value={conversation.draft}
          readOnly={conversation.sending}
          rows={1}
          maxLength={29000}
          onChange={(event) => conversation.onDraftChange(event.target.value)}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing &&
              event.nativeEvent.keyCode !== 229
            ) {
              event.preventDefault();
              if (!event.repeat) submit();
            }
          }}
        />
        <button type="submit" disabled={blocked}>
          {conversation.sending ? "Sending…" : "Send"}
        </button>
      </form>
    </section>
  );
}
