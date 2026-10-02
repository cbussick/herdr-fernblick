import { useRef, useState, type ReactNode } from "react";
import type { Snapshot } from "../../../packages/pi-live-chat/protocol";
import { ChatTranscript } from "../agents/ChatTranscript";
import { StatusIndicator } from "../../shared/ui";
import styles from "./ConversationDock.module.css";

/** A view of the existing chat. The console retains ownership of drafts and sends. */
export interface BoardPromptContext {
  boardId: string;
  revision: number;
  text: string;
  uploadId?: string;
}
export interface WhiteboardConversation {
  snapshot?: Pick<Snapshot, "messages" | "truncated">;
  agentName: string;
  showThinking: boolean;
  draft: string;
  sending: boolean;
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
  history?: ReactNode;
}
export function ConversationDock({
  conversation,
  disabled,
  inert,
  activity,
  recovery,
  history,
}: ConversationDockProps) {
  const [expanded, setExpanded] = useState(false);
  // An unavailable chat frame is not a new conversation. The enclosing board
  // unmounts on confirmed identity replacement, so this cache cannot cross targets.
  const [retained, setRetained] = useState(conversation.snapshot);
  if (conversation.snapshot && conversation.snapshot !== retained)
    setRetained(conversation.snapshot);
  const snapshot = conversation.snapshot ?? retained;
  const messages = snapshot?.messages ?? [];
  const lastUser = messages.findLastIndex((message) => message.role === "user");
  // Latest-turn detection is only for status, never for filtering the transcript.
  const hasReply = messages
    .slice(lastUser + 1)
    .some(
      (message) => message.role === "assistant" && (message.text || message.attachments?.length),
    );
  const expandButton = useRef<HTMLButtonElement>(null);
  const blocked = disabled || inert || conversation.sending || !conversation.draft.trim();
  function submit() {
    if (!blocked) conversation.onSend();
  }
  return (
    <section
      className={styles.dock}
      data-ui="conversation-dock"
      data-testid="whiteboard-conversation"
      data-expanded={expanded || undefined}
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
          setExpanded(false);
          expandButton.current?.focus();
        }
      }}
    >
      <header
        className={styles.activity}
        data-testid="whiteboard-activity"
        data-warning={activity.warning || undefined}
      >
        <div className={styles["activity__text"]} role={activity.warning ? "alert" : "status"}>
          <p>
            {activity.working && !activity.warning ? (
              <StatusIndicator status="working" label="Agent is working" />
            ) : (
              activity.message || (hasReply ? "Reply ready" : "Conversation")
            )}
          </p>
          {activity.detail}
          <p>Prompts send the drawing and allow edits.</p>
        </div>
        {activity.action}
        <button
          ref={expandButton}
          type="button"
          aria-expanded={expanded}
          aria-controls="whiteboard-conversation-messages"
          aria-label={expanded ? "Collapse conversation" : "Expand conversation"}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "Collapse" : "Expand"}
        </button>
      </header>
      {recovery}
      {history ? <div className={styles.history}>{history}</div> : null}
      <ChatTranscript
        id="whiteboard-conversation-messages"
        testId="whiteboard-replies"
        messages={messages}
        truncated={snapshot?.truncated ?? false}
        agentName={conversation.agentName}
        showThinking={conversation.showThinking}
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
          placeholder="Ask the agent to edit this board…"
          value={conversation.draft}
          readOnly={conversation.sending}
          rows={1}
          maxLength={29000}
          onChange={(event) => conversation.onDraftChange(event.target.value)}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              (event.metaKey || event.ctrlKey) &&
              !event.nativeEvent.isComposing
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
