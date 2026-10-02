import a11yStyles from "../../styles/accessibility.module.css";
import consoleStyles from "./Console.module.css";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type RefObject,
} from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { Agent, KeyName } from "../../shared/api/contracts";
import { matchesTarget, targetOf, type Target } from "../../../packages/pi-live-chat/protocol";
import { getAgentTabLabel, getAgentTarget, getStatusLabel } from "./agentPresentation";
import { getAgentOutput, sendAgentKey, chatCommand, uploadImage } from "../../shared/api/apiClient";
import { useLiveChat } from "./useLiveChat";
import { ChatTranscript } from "./ChatTranscript";
import { CloseTabButton } from "./CloseTabButton";
import { ConversationTreeDialog } from "./ConversationTreeDialog";
import { Whiteboard } from "../whiteboard/Whiteboard";
import { boardApi } from "../whiteboard/boardApi";
import type { BoardPromptContext } from "../whiteboard/ConversationDock";
import { WhiteboardButton } from "../whiteboard/WhiteboardButton";
import whiteboardStyles from "../whiteboard/WhiteboardButton.module.css";
import { BackIcon, BranchIcon, CloseIcon, ImageIcon, SendIcon } from "../../shared/ui/Icons";
import { IconButton, StatusIndicator, TabKindIcon } from "../../shared/ui";
import { StateIcon, StateNotice } from "../../shared/ui/StateFeedback";

interface AgentConsoleProps {
  agent: Agent;
  onBack: () => void;
}
type AgentView = "chat" | "terminal";
type Attachment = { file?: File; id?: string; previewUrl: string };
type OutgoingDraft = {
  text: string;
  attachments: Attachment[];
  target: Target;
  board?: BoardPromptContext;
};
function submissionId() {
  // getRandomValues also works on the dashboard's non-HTTPS private IP origin.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
const showThinkingStorageKey = "fernblick.showThinking";
function initialShowThinking() {
  try {
    return window.localStorage.getItem(showThinkingStorageKey) !== "false";
  } catch {
    return true;
  }
}
const keyControls: { key: KeyName; label: string }[] = [
  { key: "esc", label: "Esc" },
  { key: "ctrl+c", label: "Ctrl+C" },
  { key: "up", label: "↑" },
  { key: "down", label: "↓" },
  { key: "enter", label: "Enter" },
];

export function AgentConsole({ agent, onBack }: AgentConsoleProps) {
  const target = getAgentTarget(agent);
  const [prompt, setPrompt] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [attachmentError, setAttachmentError] = useState("");
  const [treeTarget, setTreeTarget] = useState<Target | null>(null);
  const [boardTarget, setBoardTarget] = useState<Target | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadedIds = useRef(new Map<File, string>());
  const previews = useRef(new Set<string>());
  const [view, setView] = useState<AgentView>("chat");
  const [showThinking, setShowThinking] = useState(initialShowThinking);
  const outputRef = useRef<HTMLElement>(null);
  const shouldFollowRef = useRef(true);
  const live = useLiveChat(agent.pane_id, view === "chat", agent.agent_session?.value);
  const snapshot = live.snapshot;
  const sendLock = useRef(false);
  const liveContext = useRef({
    snapshot,
    lastSnapshot: snapshot,
    boardTarget,
    prompt,
    error: live.error,
  });
  useLayoutEffect(() => {
    liveContext.current = {
      snapshot,
      lastSnapshot: snapshot ?? liveContext.current.lastSnapshot,
      boardTarget,
      prompt,
      error: live.error,
    };
  });
  const initializing = view === "chat" && !snapshot && !live.error;
  const starting = initializing && !agent.agent_session;
  // Discard a captured tree target before rendering commands for a replacement session.
  if (
    treeTarget &&
    (!snapshot ||
      treeTarget.runtime !== snapshot.identity.runtime ||
      treeTarget.epoch !== snapshot.epoch ||
      treeTarget.sessionId !== snapshot.identity.sessionId)
  ) {
    setTreeTarget(null);
  }
  if (
    boardTarget &&
    snapshot &&
    (boardTarget.runtime !== snapshot.identity.runtime ||
      boardTarget.epoch !== snapshot.epoch ||
      boardTarget.sessionId !== snapshot.identity.sessionId)
  ) {
    // Missing live state pauses sending; only a confirmed identity change closes
    // the board. Unmount then aborts in-flight work and retains the old draft.
    setBoardTarget(null);
  }
  const outputQuery = useQuery({
    queryKey: ["agent-output", target],
    queryFn: () => getAgentOutput(target),
    enabled: view === "terminal",
    refetchInterval: view === "terminal" ? 1000 : false,
  });
  const send = useMutation({
    mutationFn: async (draft: OutgoingDraft) => {
      if (draft.board) {
        return boardApi.prompt(agent.pane_id, {
          target: draft.target,
          boardId: draft.board.boardId,
          revision: draft.board.revision,
          ...(draft.board.uploadId ? { uploadId: draft.board.uploadId } : {}),
          text: draft.text,
          requestId: submissionId(),
        });
      }
      const ids: string[] = [];
      for (const attachment of draft.attachments) {
        if (attachment.id) ids.push(attachment.id);
        else if (attachment.file) {
          let id = uploadedIds.current.get(attachment.file);
          if (!id) {
            id = (await uploadImage(attachment.file)).id;
            uploadedIds.current.set(attachment.file, id);
          }
          ids.push(id);
        }
      }
      return chatCommand(agent.pane_id, draft.target, "prompt", draft.text, ids, submissionId());
    },
    onSuccess: (_ack, draft) => {
      const latest = liveContext.current.lastSnapshot;
      if (latest && !matchesTarget(latest, draft.target)) {
        resetSend();
        return;
      }
      setPrompt((current) => (current === draft.text ? "" : current));
      setAttachments((current) =>
        current.filter((attachment) => !draft.attachments.includes(attachment)),
      );
      for (const attachment of draft.attachments) {
        if (previews.current.delete(attachment.previewUrl))
          URL.revokeObjectURL(attachment.previewUrl);
        if (attachment.file) uploadedIds.current.delete(attachment.file);
      }
      setAttachmentError("");
      resetSend();
    },
    onSettled: () => {
      sendLock.current = false;
    },
    gcTime: 0,
    retry: false,
    // ACK confirms forwarding only. No Pi receipt, hidden backup, or automatic retry.
  });
  const resetSend = send.reset;
  const stop = useMutation({
    mutationFn: () => {
      if (!snapshot) throw new Error("Live chat unavailable");
      return chatCommand(agent.pane_id, targetOf(snapshot), "stop");
    },
    retry: false,
  });
  const keyMutation = useMutation({
    mutationFn: (key: KeyName) => sendAgentKey(target, key),
    retry: false,
  });
  useEffect(() => {
    const urls = previews.current;
    return () => {
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, []);
  useEffect(() => {
    if (outputRef.current && shouldFollowRef.current)
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
  }, [snapshot?.epoch, snapshot?.seq, outputQuery.data?.revision, view]);
  function trackScroll() {
    const el = outputRef.current;
    if (el) shouldFollowRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  }
  const composerSending = send.isPending;
  const canSend = Boolean(
    snapshot &&
    snapshot.version === 2 &&
    !live.error &&
    !snapshot.busy &&
    !snapshot.sendPending &&
    (prompt.trim() || attachments.length) &&
    !send.isPending,
  );
  function clearAttachments() {
    for (const url of previews.current) URL.revokeObjectURL(url);
    previews.current.clear();
    uploadedIds.current.clear();
    setAttachments([]);
    setAttachmentError("");
  }
  function selectImages(files: FileList | null) {
    if (!files) return;
    if (send.isError) {
      send.reset();
    }
    const selected = Array.from(files);
    const valid = selected.filter(
      (file) =>
        ["image/png", "image/jpeg", "image/gif", "image/webp"].includes(file.type) &&
        file.size > 0 &&
        file.size <= 10 * 1024 * 1024,
    );
    setAttachmentError(
      valid.length !== selected.length || selected.length + attachments.length > 4
        ? "Choose up to four PNG, JPEG, GIF or WebP images, at most 10 MiB each."
        : "",
    );
    const additions = valid.slice(0, 4 - attachments.length).map((file) => {
      const previewUrl = URL.createObjectURL(file);
      previews.current.add(previewUrl);
      return { file, previewUrl };
    });
    setAttachments((current) => [...current, ...additions]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }
  function changePrompt(text: string) {
    if (send.isError) send.reset();
    setPrompt(text);
  }
  function sendDraft(draft: OutgoingDraft) {
    // React's pending state may not have rendered before a second tap/shortcut.
    if (sendLock.current) return;
    sendLock.current = true;
    send.mutate(draft);
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (canSend && snapshot)
      sendDraft({ text: prompt, attachments: [...attachments], target: targetOf(snapshot) });
  }
  function submitBoardPrompt(expected: Target, board: BoardPromptContext) {
    const current = liveContext.current;
    if (
      current.boardTarget !== expected ||
      !current.snapshot ||
      current.snapshot.version !== 2 ||
      current.error ||
      current.snapshot.busy ||
      current.snapshot.sendPending ||
      !current.snapshot.capabilities?.boards ||
      !matchesTarget(current.snapshot, expected) ||
      !board.text.trim()
    )
      return;
    // Only the board's prepared PNG may accompany the grant, never queued chat images.
    sendDraft({ text: board.text, attachments: [], target: expected, board });
  }
  return (
    <main className={consoleStyles["console"]} data-testid="console" id="main-content">
      <header className={consoleStyles["console-header"]} data-testid="console-header">
        <IconButton label="Back to overview" onClick={onBack}>
          <BackIcon />
        </IconButton>
        <TabKindIcon kind="agent" />
        <div className={consoleStyles["console-header__copy"]}>
          <p>{agent.workspace_label ?? agent.workspace_id}</p>
          <div className={consoleStyles["console-header__title"]}>
            <h2>{getAgentTabLabel(agent)}</h2>
          </div>
        </div>
        <CloseTabButton
          agentRunning
          agentName={agent.name}
          agentTarget={target}
          label={getAgentTabLabel(agent)}
          tabId={agent.tab_id}
          onClosed={onBack}
          agentStatus={agent.agent_status}
          showThinking={showThinking}
          onShowThinkingChange={(show) => {
            setShowThinking(show);
            try {
              window.localStorage.setItem(showThinkingStorageKey, String(show));
            } catch {
              /* Optional preference. */
            }
          }}
        />
        <button
          type="button"
          className={consoleStyles["agent-view-toggle"]}
          aria-label={`Switch to ${view === "chat" ? "Terminal" : "Chat"} view`}
          onClick={() => setView((current) => (current === "chat" ? "terminal" : "chat"))}
        >
          {view === "chat" ? "Terminal" : "Chat"}
        </button>
        <StatusIndicator
          status={initializing ? "unknown" : agent.agent_status}
          label={
            initializing
              ? starting
                ? "Starting"
                : "Connecting"
              : getStatusLabel(agent.agent_status)
          }
        />
      </header>
      {agent.agent_status === "blocked" ? (
        <div className={consoleStyles["attention-banner"]} role="status">
          <strong>Needs your input</strong>
          <span>The agent is waiting for a decision.</span>
        </div>
      ) : null}
      <section
        className={consoleStyles["output-panel"] + " " + consoleStyles[`output-panel--${view}`]}
        data-testid="output-panel"
        data-view={view}
        aria-label={view === "chat" ? "Agent conversation" : "Terminal output"}
      >
        {view === "terminal" ? (
          <>
            <div className={consoleStyles["output-panel__bar"]}>
              <span>Agent output</span>
              <span>ANSI</span>
            </div>
            {outputQuery.isPending ? (
              <div className={consoleStyles["terminal-state"]} aria-busy="true">
                <StateIcon kind="loading" />
                <p>Reading agent output…</p>
              </div>
            ) : outputQuery.isError ? (
              <div
                className={
                  consoleStyles["terminal-state"] + " " + consoleStyles["terminal-state--error"]
                }
                data-testid="terminal-state--error"
                role="alert"
              >
                <StateIcon kind="unavailable" />
                <p>{outputQuery.error.message}</p>
              </div>
            ) : !outputQuery.data.text ? (
              <div className={consoleStyles["terminal-state"]}>
                <StateIcon kind="terminal" />
                <p>No agent output yet.</p>
              </div>
            ) : (
              <pre
                ref={outputRef as RefObject<HTMLPreElement>}
                className={consoleStyles["terminal-output"]}
                tabIndex={0}
                onScroll={trackScroll}
              >
                {outputQuery.data.text}
              </pre>
            )}
          </>
        ) : live.error && !snapshot ? (
          <div
            className={
              consoleStyles["terminal-state"] + " " + consoleStyles["terminal-state--error"]
            }
            data-testid="terminal-state--error"
            role="alert"
          >
            <StateIcon kind="unavailable" />
            <p>{live.error}</p>
          </div>
        ) : !snapshot ? (
          <div
            className={
              consoleStyles["terminal-state"] + " " + consoleStyles["transcript-initializing"]
            }
            role="status"
            aria-busy="true"
          >
            <StateIcon kind="loading" spinning />
            <p>{starting ? "Starting Pi…" : "Connecting to Pi live chat…"}</p>
          </div>
        ) : (
          <ChatTranscript
            key={JSON.stringify(targetOf(snapshot))}
            messages={snapshot.messages}
            truncated={snapshot.truncated}
            agentName={getAgentTabLabel(agent)}
            showThinking={showThinking}
            before={
              <>
                {live.error ? <StateNotice kind="unavailable">{live.error}</StateNotice> : null}
                {snapshot.version !== 2 ? (
                  <StateNotice kind="info">
                    Run /reload in Pi to update the chat connection.
                  </StateNotice>
                ) : null}
              </>
            }
            after={
              <>
                {snapshot.busy ? (
                  <div className={consoleStyles["chat-working"]} role="status">
                    <StatusIndicator status="working" label="Working" />
                    <button
                      type="button"
                      disabled={stop.isPending || Boolean(live.error)}
                      onClick={() => stop.mutate()}
                    >
                      {stop.isPending ? "Requesting stop…" : "Stop"}
                    </button>
                    {stop.isSuccess ? <span>Abort invoked; waiting for Pi events.</span> : null}
                  </div>
                ) : null}
              </>
            }
          />
        )}
      </section>
      {view === "terminal" ? (
        <div className={consoleStyles["key-controls"]} aria-label="Terminal controls">
          {keyControls.map((control) => (
            <button
              type="button"
              key={control.key}
              disabled={keyMutation.isPending}
              onClick={() => keyMutation.mutate(control.key)}
            >
              {control.label}
            </button>
          ))}
          {keyMutation.isError ? (
            <StateNotice kind="unavailable" role="alert">
              {keyMutation.error.message}
            </StateNotice>
          ) : null}
        </div>
      ) : (
        <form
          className={consoleStyles["prompt-composer"]}
          aria-busy={composerSending}
          onSubmit={submit}
        >
          <div className={consoleStyles["prompt-composer__surface"]}>
            {attachments.length ? (
              <div className={consoleStyles["prompt-attachments"]} aria-label="Image attachments">
                {attachments.map((attachment, i) => (
                  <div className={consoleStyles["prompt-attachment"]} key={attachment.previewUrl}>
                    <img
                      src={attachment.previewUrl}
                      alt={attachment.file?.name ?? "Restored image attachment"}
                    />
                    <button
                      type="button"
                      disabled={composerSending}
                      aria-label={`Remove image ${i + 1}`}
                      onClick={() => {
                        if (send.isError) {
                          send.reset();
                        }
                        if (previews.current.delete(attachment.previewUrl))
                          URL.revokeObjectURL(attachment.previewUrl);
                        setAttachments((current) =>
                          current.filter((value) => value !== attachment),
                        );
                      }}
                    >
                      <CloseIcon />
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
            <label htmlFor="agent-prompt" className={a11yStyles["sr-only"]}>
              Message {getAgentTabLabel(agent)}
            </label>
            <div
              className={
                consoleStyles["prompt-composer__row"] + " " + whiteboardStyles["composer-row"]
              }
            >
              <input
                ref={fileInputRef}
                className={a11yStyles["sr-only"]}
                type="file"
                accept="image/png,image/jpeg,image/gif,image/webp"
                multiple
                disabled={composerSending}
                onChange={(event) => selectImages(event.target.files)}
              />
              <button
                type="button"
                className={consoleStyles["prompt-composer__attach"]}
                disabled={composerSending || attachments.length >= 4}
                title="Attach images"
                aria-label="Attach images"
                onClick={() => fileInputRef.current?.click()}
              >
                <ImageIcon />
              </button>
              <button
                type="button"
                className={consoleStyles["prompt-composer__tree"]}
                aria-label="Open conversation paths"
                title="Conversation paths"
                disabled={!snapshot || Boolean(live.error) || composerSending}
                onClick={() => snapshot && setTreeTarget(targetOf(snapshot))}
              >
                <BranchIcon />
              </button>
              <WhiteboardButton
                className={consoleStyles["prompt-composer__tree"]}
                disabled={!snapshot || snapshot.version !== 2 || composerSending}
                onClick={() => snapshot && setBoardTarget(targetOf(snapshot))}
              />
              <textarea
                id="agent-prompt"
                value={prompt}
                disabled={composerSending}
                onChange={(event) => changePrompt(event.target.value)}
                placeholder={`Send to ${getAgentTabLabel(agent)} when idle…`}
                rows={1}
                maxLength={32000}
              />
              <button
                type="submit"
                aria-label="Send message"
                aria-busy={composerSending}
                disabled={!canSend}
              >
                {composerSending ? (
                  <span
                    className={consoleStyles["prompt-composer__spinner"]}
                    data-testid="send-spinner"
                    aria-hidden="true"
                  />
                ) : (
                  <SendIcon />
                )}
              </button>
            </div>
          </div>
          {attachmentError ? (
            <StateNotice kind="info" role="alert">
              {attachmentError}
            </StateNotice>
          ) : null}
          {send.isError ? (
            <StateNotice kind="unavailable" role="alert">
              {send.error.message} Draft retained; check Pi before retrying.
            </StateNotice>
          ) : null}
          {stop.isError ? (
            <StateNotice kind="unavailable" role="alert">
              {stop.error.message}
            </StateNotice>
          ) : null}
        </form>
      )}
      {view === "chat" && snapshot ? (
        <div className={consoleStyles["pi-status-line"]} aria-label="Pi session status">
          <span>
            {snapshot.status.model ?? "Unknown model"} · {snapshot.status.cwd}
          </span>
          <span>
            {snapshot.status.totalTokens.toLocaleString()} displayed tokens · $
            {snapshot.status.cost.toFixed(2)} · {snapshot.status.provider}
          </span>
        </div>
      ) : null}
      {treeTarget ? (
        <ConversationTreeDialog
          open
          target={agent.pane_id}
          identity={treeTarget}
          busy={
            !snapshot ||
            Boolean(live.error) ||
            snapshot.busy ||
            snapshot.sendPending ||
            composerSending
          }
          onClose={() => setTreeTarget(null)}
          onRestorePrompt={(text, ids) => {
            clearAttachments();
            setPrompt(text);
            setAttachments(ids.map((id) => ({ id, previewUrl: `/api/uploads/${id}` })));
            send.reset();
          }}
        />
      ) : null}
      {boardTarget ? (
        <Whiteboard
          key={boardTarget.sessionId}
          pane={agent.pane_id}
          target={boardTarget}
          agentState={
            !snapshot || live.error
              ? "disconnected"
              : snapshot.version !== 2
                ? "unsupported"
                : snapshot.sendPending || composerSending
                  ? "waiting"
                  : snapshot.busy
                    ? "working"
                    : "ready"
          }
          structured={Boolean(snapshot?.capabilities?.boards)}
          conversation={{
            snapshot,
            agentName: getAgentTabLabel(agent),
            showThinking,
            draft: prompt,
            sending: composerSending,
            error: send.isError
              ? `${send.error.message} Draft retained; check the conversation before retrying.`
              : undefined,
            onDraftChange: changePrompt,
            onSend: (board) => submitBoardPrompt(boardTarget, board),
          }}
          onClose={() => setBoardTarget(null)}
        />
      ) : null}
    </main>
  );
}
