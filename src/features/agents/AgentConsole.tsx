import a11yStyles from "../../styles/accessibility.module.css";
import consoleStyles from "./Console.module.css";
import { useEffect, useRef, useState, type FormEvent, type RefObject } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { Agent, KeyName } from "../../shared/api/contracts";
import { targetOf, type Target } from "../../../packages/pi-live-chat/protocol";
import { getAgentTabLabel, getAgentTarget, getStatusLabel } from "./agentPresentation";
import { getAgentOutput, sendAgentKey, chatCommand, uploadImage } from "../../shared/api/apiClient";
import { useLiveChat } from "./useLiveChat";
import { ChatMessageText } from "./ChatMessageText";
import { CloseTabButton } from "./CloseTabButton";
import { ConversationTreeDialog } from "./ConversationTreeDialog";
import {
  BackIcon,
  BranchIcon,
  CloseIcon,
  ImageIcon,
  LightbulbIcon,
  SendIcon,
} from "../../shared/ui/Icons";
import { IconButton, StatusIndicator, TabKindIcon } from "../../shared/ui";
import { StateIcon, StateNotice } from "../../shared/ui/StateFeedback";

interface AgentConsoleProps {
  agent: Agent;
  onBack: () => void;
}
type AgentView = "chat" | "terminal";
type Attachment = { file?: File; id?: string; previewUrl: string };
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
function ChatAttachment({ url, onOpen }: { url: string; onOpen: () => void }) {
  const [unavailable, setUnavailable] = useState(false);
  if (unavailable) {
    return (
      <div
        className={consoleStyles["chat-attachment-unavailable"]}
        role="img"
        aria-label="Attachment unavailable"
      >
        <ImageIcon />
        <span>Attachment no longer available</span>
      </div>
    );
  }
  return (
    <button type="button" aria-label="Open attached image" onClick={onOpen}>
      <img src={url} alt="User attachment" loading="lazy" onError={() => setUnavailable(true)} />
    </button>
  );
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
  const [submission, setSubmission] = useState<{
    id: string;
    target: Target;
    text: string;
    attachments: Attachment[];
  }>();
  const [treeTarget, setTreeTarget] = useState<Target | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadedIds = useRef(new Map<File, string>());
  const previews = useRef(new Set<string>());
  const [view, setView] = useState<AgentView>("chat");
  const [showThinking, setShowThinking] = useState(initialShowThinking);
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);
  const lightboxRef = useRef<HTMLDialogElement>(null);
  const outputRef = useRef<HTMLElement>(null);
  const shouldFollowRef = useRef(true);
  const live = useLiveChat(agent.pane_id, view === "chat", agent.agent_session?.value);
  const snapshot = live.snapshot;
  const outputQuery = useQuery({
    queryKey: ["agent-output", target],
    queryFn: () => getAgentOutput(target),
    enabled: view === "terminal",
    refetchInterval: view === "terminal" ? 1000 : false,
  });
  const send = useMutation({
    mutationFn: async () => {
      if (!snapshot) throw new Error("Live chat unavailable");
      const identity = targetOf(snapshot);
      const ids: string[] = [];
      for (const attachment of attachments) {
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
      const id = submissionId();
      setSubmission({ id, target: identity, text: prompt, attachments });
      return chatCommand(agent.pane_id, identity, "prompt", prompt, ids, id);
    },
    retry: false,
    // Receipt arrives independently over SSE, including after a lost HTTP ACK.
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
    if (lightboxImage && lightboxRef.current && !lightboxRef.current.open)
      lightboxRef.current.showModal();
  }, [lightboxImage]);
  useEffect(() => {
    if (outputRef.current && shouldFollowRef.current)
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
  }, [snapshot?.epoch, snapshot?.seq, outputQuery.data?.revision, view]);
  function trackScroll() {
    const el = outputRef.current;
    if (el) shouldFollowRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  }
  useEffect(() => {
    if (
      !submission ||
      !snapshot ||
      !snapshot.receivedSendIds?.includes(submission.id) ||
      snapshot.identity.runtime !== submission.target.runtime ||
      snapshot.identity.sessionId !== submission.target.sessionId
    )
      return;
    // oxlint-disable-next-line react/set-state-in-effect -- Synchronize the submitted draft with an external Pi receipt.
    setPrompt((current) => (current === submission.text ? "" : current));
    setAttachments((current) =>
      current.filter((attachment) => !submission.attachments.includes(attachment)),
    );
    for (const attachment of submission.attachments) {
      if (previews.current.delete(attachment.previewUrl))
        URL.revokeObjectURL(attachment.previewUrl);
      if (attachment.file) uploadedIds.current.delete(attachment.file);
    }
    setAttachmentError("");
    setSubmission(undefined);
    resetSend();
  }, [submission, snapshot, resetSend]);
  const canSend = Boolean(
    snapshot &&
    snapshot.version === 2 &&
    !live.error &&
    !snapshot.busy &&
    !snapshot.sendPending &&
    (prompt.trim() || attachments.length) &&
    !send.isPending &&
    !submission,
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
      setSubmission(undefined);
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
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (canSend) send.mutate();
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
        <StatusIndicator status={agent.agent_status} label={getStatusLabel(agent.agent_status)} />
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
          <div className={consoleStyles["terminal-state"]} aria-busy="true">
            <StateIcon kind="loading" />
            <p>Connecting to Pi live chat…</p>
          </div>
        ) : (
          <div
            ref={outputRef as RefObject<HTMLDivElement>}
            className={consoleStyles["chat-transcript"]}
            data-testid="chat-transcript"
            data-empty={!snapshot.messages.length || undefined}
            tabIndex={0}
            onScroll={trackScroll}
          >
            {live.error ? <StateNotice kind="unavailable">{live.error}</StateNotice> : null}
            {snapshot.version !== 2 ? (
              <StateNotice kind="info">
                Run /reload in Pi to update the chat connection.
              </StateNotice>
            ) : null}
            {snapshot.truncated ? (
              <StateNotice kind="info">
                Showing a bounded recent transcript; some content is omitted.
              </StateNotice>
            ) : null}
            {snapshot.messages
              .filter((message) => showThinking || message.role !== "thinking")
              .map((message) =>
                message.role === "status" ? (
                  <StateNotice kind="info" key={message.id}>
                    {message.text}
                  </StateNotice>
                ) : message.role === "thinking" ? (
                  <div className={consoleStyles["chat-thinking"]} key={message.id}>
                    <LightbulbIcon />
                    <span className={a11yStyles["sr-only"]}>Thinking: </span>
                    <ChatMessageText text={message.text} />
                  </div>
                ) : message.role === "tool" ? (
                  <details
                    className={
                      consoleStyles["chat-tool"] +
                      " " +
                      (message.isError ? consoleStyles["chat-tool--error"] : "")
                    }
                    data-testid="chat-tool"
                    key={message.id}
                  >
                    <summary>{message.toolName}</summary>
                    <pre>{message.text}</pre>
                  </details>
                ) : (
                  <article
                    className={
                      consoleStyles["chat-message"] +
                      " " +
                      (message.role === "user" ? consoleStyles["chat-message--user"] : "")
                    }
                    key={message.id}
                  >
                    <span>{message.role === "user" ? "You" : getAgentTabLabel(agent)}</span>
                    {message.text ? <ChatMessageText text={message.text} /> : null}
                    {message.attachments?.length ? (
                      <div className={consoleStyles["chat-message__attachments"]}>
                        {message.attachments.map((url, i) => (
                          <ChatAttachment key={i} url={url} onOpen={() => setLightboxImage(url)} />
                        ))}
                      </div>
                    ) : null}
                  </article>
                ),
              )}
            {!snapshot.messages.length ? (
              <div className={consoleStyles["terminal-state"]}>
                <StateIcon kind="empty" />
                <p>No messages yet.</p>
              </div>
            ) : null}
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
            {snapshot.sendPending ? <StateNotice kind="sending">Sending to Pi…</StateNotice> : null}
          </div>
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
        <form className={consoleStyles["prompt-composer"]} onSubmit={submit}>
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
                      disabled={send.isPending}
                      aria-label={`Remove image ${i + 1}`}
                      onClick={() => {
                        if (send.isError) {
                          setSubmission(undefined);
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
            <div className={consoleStyles["prompt-composer__row"]}>
              <input
                ref={fileInputRef}
                className={a11yStyles["sr-only"]}
                type="file"
                accept="image/png,image/jpeg,image/gif,image/webp"
                multiple
                onChange={(event) => selectImages(event.target.files)}
              />
              <button
                type="button"
                className={consoleStyles["prompt-composer__attach"]}
                disabled={send.isPending || attachments.length >= 4}
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
                disabled={!snapshot || Boolean(live.error) || send.isPending}
                onClick={() => snapshot && setTreeTarget(targetOf(snapshot))}
              >
                <BranchIcon />
              </button>
              <textarea
                id="agent-prompt"
                value={prompt}
                disabled={send.isPending}
                onChange={(event) => {
                  if (send.isError) {
                    setSubmission(undefined);
                    send.reset();
                  }
                  setPrompt(event.target.value);
                }}
                placeholder={`Send to ${getAgentTabLabel(agent)} when idle…`}
                rows={1}
                maxLength={32000}
              />
              <button type="submit" aria-label="Send message" disabled={!canSend}>
                <SendIcon />
              </button>
            </div>
          </div>
          {attachmentError ? (
            <StateNotice kind="info" role="alert">
              {attachmentError}
            </StateNotice>
          ) : null}
          {submission && send.isSuccess ? (
            <StateNotice kind="sending">Waiting for Pi to receive your message…</StateNotice>
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
          busy={!snapshot || snapshot.busy || snapshot.sendPending || send.isPending}
          onClose={() => setTreeTarget(null)}
          onRestorePrompt={(text, ids) => {
            setSubmission(undefined);
            clearAttachments();
            setPrompt(text);
            setAttachments(ids.map((id) => ({ id, previewUrl: `/api/uploads/${id}` })));
            send.reset();
          }}
        />
      ) : null}
      {lightboxImage ? (
        <dialog
          ref={lightboxRef}
          className={consoleStyles["image-lightbox"]}
          aria-label="Image preview"
          onClose={() => setLightboxImage(null)}
          onClick={(event) => {
            if (event.target === event.currentTarget) event.currentTarget.close();
          }}
        >
          <button
            type="button"
            className={consoleStyles["image-lightbox__close"]}
            aria-label="Close image preview"
            onClick={() => lightboxRef.current?.close()}
          >
            <CloseIcon />
          </button>
          <img src={lightboxImage} alt="Expanded user attachment" />
        </dialog>
      ) : null}
    </main>
  );
}
