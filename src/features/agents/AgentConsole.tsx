import { useEffect, useRef, useState, type FormEvent, type RefObject } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Agent, KeyName } from "../../shared/api/contracts";
import { getAgentTabLabel, getAgentTarget, getStatusLabel } from "./agentPresentation";
import {
  getAgentOutput,
  getAgentTranscript,
  getQueuedMessages,
  queueMessage,
  editQueuedMessage,
  removeQueuedMessage,
  retryQueuedMessage,
  acknowledgeQueuedMessage,
  uploadImage,
  sendAgentKey,
} from "../../shared/api/apiClient";
import { ChatMessageText } from "./ChatMessageText";
import { CloseTabButton } from "./CloseTabButton";
import {
  BackIcon,
  BranchIcon,
  CloseIcon,
  ImageIcon,
  LightbulbIcon,
  SendIcon,
} from "../../shared/ui/Icons";
import { IconButton, StatusIndicator, TabKindIcon } from "../../shared/ui";
import { ConversationTreeDialog } from "./ConversationTreeDialog";

interface AgentConsoleProps {
  agent: Agent;
  onBack: () => void;
}
type AgentView = "chat" | "terminal";
type PendingAttachment = { file: File; previewUrl: string };
const showThinkingStorageKey = "fernblick.showThinking";

function initialShowThinking() {
  try {
    return window.localStorage.getItem(showThinkingStorageKey) !== "false";
  } catch {
    return true;
  }
}
function thinkingText(text: string) {
  return text.replace(/^\*\*(.+)\*\*$/s, "$1");
}

function ChatAttachment({ url, onOpen }: { url: string; onOpen: () => void }) {
  const [unavailable, setUnavailable] = useState(false);
  if (unavailable) {
    return (
      <div className="chat-attachment-unavailable" role="img" aria-label="Attachment unavailable">
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

function ElapsedTime({ since }: { since?: number }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  const seconds = since ? Math.max(0, Math.floor((now - since) / 1000)) : 0;
  const label =
    seconds >= 3600
      ? `${Math.floor(seconds / 3600)}:${String(Math.floor((seconds % 3600) / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`
      : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

  return <span className="chat-working__elapsed">[{label}]</span>;
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
  const queryClient = useQueryClient();
  const [prompt, setPrompt] = useState("");
  const [view, setView] = useState<AgentView>("chat");
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingAttachments, setEditingAttachments] = useState<string[]>([]);
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);
  const [treeOpen, setTreeOpen] = useState(false);
  const [showThinking, setShowThinking] = useState(initialShowThinking);
  const transcriptInitializing = agent.agent === "pi" && !agent.agent_session;
  const lightboxRef = useRef<HTMLDialogElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const outputRef = useRef<HTMLElement>(null);
  const shouldFollowRef = useRef(true);
  const requestIdRef = useRef<string | null>(null);
  const uploadedIdsRef = useRef(new Map<File, string>());
  const outputQuery = useQuery({
    queryKey: ["agent-output", target],
    queryFn: () => getAgentOutput(target),
    refetchInterval: 1000,
  });
  const transcriptQuery = useQuery({
    queryKey: ["agent-transcript", target],
    queryFn: () => getAgentTranscript(target),
    enabled: view === "chat" && !transcriptInitializing,
    refetchInterval: 1000,
  });
  const queueKey = ["agent-queue", agent.pane_id, agent.agent_session?.value];
  const queueQuery = useQuery({
    queryKey: queueKey,
    queryFn: () => getQueuedMessages(target),
    enabled: Boolean(agent.agent_session?.value),
    refetchInterval: 1000,
  });
  const queued = queueQuery.data ?? [];
  const refreshQueue = () => void queryClient.invalidateQueries({ queryKey: queueKey });
  useEffect(() => {
    if (lightboxImage && lightboxRef.current && !lightboxRef.current.open) {
      lightboxRef.current.showModal();
    }
  }, [lightboxImage]);
  const queueMutation = useMutation({
    mutationFn: async ({
      id,
      text,
      files,
      existing,
    }: {
      id: string | null;
      text: string;
      files: File[];
      existing: string[];
    }) => {
      const uploaded = await Promise.all(
        files.map(async (file) => {
          const known = uploadedIdsRef.current.get(file);
          if (known) return known;
          const image = await uploadImage(file);
          uploadedIdsRef.current.set(file, image.id);
          return image.id;
        }),
      );
      const input = { text, attachments: [...existing, ...uploaded] };
      return id
        ? editQueuedMessage(target, id, input)
        : queueMessage(target, { ...input, requestId: requestIdRef.current! });
    },
    onSuccess: () => {
      attachments.forEach((attachment) => URL.revokeObjectURL(attachment.previewUrl));
      setAttachments([]);
      setEditingAttachments([]);
      setEditingId(null);
      setPrompt("");
      requestIdRef.current = null;
      uploadedIdsRef.current.clear();
      refreshQueue();
    },
  });
  const queueAction = useMutation({
    mutationFn: async ({ id, action }: { id: string; action: "remove" | "retry" | "ack" }) => {
      if (action === "remove") await removeQueuedMessage(target, id);
      else if (action === "retry") await retryQueuedMessage(target, id);
      else await acknowledgeQueuedMessage(target, id);
    },
    onSuccess: refreshQueue,
  });
  const keyMutation = useMutation({
    mutationFn: (key: KeyName) => sendAgentKey(target, key),
    onSuccess: () => {
      shouldFollowRef.current = true;
      void queryClient.invalidateQueries({ queryKey: ["agent-output", target] });
      void queryClient.invalidateQueries({ queryKey: ["agent-transcript", target] });
      void queryClient.invalidateQueries({ queryKey: ["agents"] });
    },
  });
  useEffect(() => {
    const output = outputRef.current;
    if (output && shouldFollowRef.current) output.scrollTop = output.scrollHeight;
  }, [agent.agent_status, outputQuery.data?.revision, transcriptQuery.data?.messages.length, view]);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      (!prompt.trim() && !attachments.length && !editingAttachments.length) ||
      queueMutation.isPending
    )
      return;
    if (!editingId && !requestIdRef.current) {
      requestIdRef.current = Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("");
    }
    queueMutation.mutate({
      id: editingId,
      text: prompt,
      files: attachments.map((attachment) => attachment.file),
      existing: editingAttachments,
    });
  }
  function selectImages(files: FileList | null) {
    if (!files) return;
    const accepted = Array.from(files)
      .filter((file) => ["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type))
      .filter((file) => file.size <= 10 * 1024 * 1024);
    setAttachments((current) => [
      ...current,
      ...accepted
        .slice(0, Math.max(0, 4 - current.length - editingAttachments.length))
        .map((file) => ({
          file,
          previewUrl: URL.createObjectURL(file),
        })),
    ]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }
  const trackScroll = () => {
    const output = outputRef.current;
    if (output)
      shouldFollowRef.current = output.scrollHeight - output.scrollTop - output.clientHeight < 48;
  };
  const content =
    view === "chat" ? (
      transcriptInitializing ? (
        <div className="terminal-state transcript-initializing" role="status" aria-live="polite">
          <span className="transcript-initializing__spinner" aria-hidden="true" />
          <span>Starting chat…</span>
          <small>The conversation will appear when the agent is ready.</small>
        </div>
      ) : transcriptQuery.isPending ? (
        <div className="terminal-state" aria-busy="true">
          Reading conversation…
        </div>
      ) : transcriptQuery.isError ? (
        <div className="terminal-state terminal-state--error" role="alert">
          Structured chat is unavailable. {transcriptQuery.error.message}
        </div>
      ) : (
        <div
          ref={outputRef as RefObject<HTMLDivElement>}
          className="chat-transcript"
          tabIndex={0}
          onScroll={trackScroll}
        >
          {transcriptQuery.data.messages.length ? (
            transcriptQuery.data.messages
              .filter((message) => showThinking || message.role !== "thinking")
              .map((message) =>
                message.role === "status" ? (
                  <div className="chat-status" role="status" key={message.id}>
                    {message.text}
                  </div>
                ) : message.role === "thinking" ? (
                  <div className="chat-thinking" key={message.id}>
                    <LightbulbIcon />
                    <span className="sr-only">Thinking: </span>
                    <ChatMessageText text={thinkingText(message.text)} />
                  </div>
                ) : message.role === "tool" ? (
                  <details
                    className={`chat-tool${message.isError ? " chat-tool--error" : ""}`}
                    key={message.id}
                  >
                    <summary>{message.toolName}</summary>
                    <pre>{message.text}</pre>
                  </details>
                ) : (
                  <article
                    className={`chat-message chat-message--${message.role}`}
                    key={message.id}
                  >
                    <span>{message.role === "user" ? "You" : getAgentTabLabel(agent)}</span>
                    {message.text ? <ChatMessageText text={message.text} /> : null}
                    {message.attachments?.length ? (
                      <div className="chat-message__attachments">
                        {message.attachments.map((url) => (
                          <ChatAttachment
                            key={url}
                            url={url}
                            onOpen={() => setLightboxImage(url)}
                          />
                        ))}
                      </div>
                    ) : null}
                  </article>
                ),
              )
          ) : (
            <div className="terminal-state">No messages yet.</div>
          )}
          {agent.agent_status === "working" ? (
            <div className="chat-working" role="status" aria-live="polite">
              <StatusIndicator status="working" label="Working" />
              <ElapsedTime since={transcriptQuery.data.status.workingSince} />
              <button
                type="button"
                disabled={keyMutation.isPending}
                onClick={() => keyMutation.mutate("esc")}
              >
                {keyMutation.isPending ? "Stopping…" : "Stop"}
              </button>
            </div>
          ) : null}
        </div>
      )
    ) : outputQuery.isPending ? (
      <div className="terminal-state" aria-busy="true">
        Reading agent output…
      </div>
    ) : outputQuery.isError ? (
      <div className="terminal-state terminal-state--error" role="alert">
        Could not read this agent. {outputQuery.error.message}
      </div>
    ) : (
      <pre
        ref={outputRef as RefObject<HTMLPreElement>}
        className="terminal-output"
        tabIndex={0}
        onScroll={trackScroll}
      >
        {outputQuery.data.text || "No agent output yet."}
      </pre>
    );
  return (
    <main className="console" id="main-content">
      <header className="console-header">
        <IconButton label="Back to overview" onClick={onBack}>
          <BackIcon />
        </IconButton>
        <TabKindIcon kind="agent" />
        <div className="console-header__copy">
          <p>{agent.workspace_label ?? agent.workspace_id}</p>
          <div className="console-header__title">
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
              // The preference remains active for this page when storage is unavailable.
            }
          }}
        />
        <button
          type="button"
          className="agent-view-toggle"
          aria-label={`Switch to ${view === "chat" ? "Terminal" : "Chat"} view`}
          title={`Switch to ${view === "chat" ? "Terminal" : "Chat"} view`}
          onClick={() => setView((current) => (current === "chat" ? "terminal" : "chat"))}
        >
          {view === "chat" ? "Chat" : "Terminal"}
        </button>
        <StatusIndicator status={agent.agent_status} label={getStatusLabel(agent.agent_status)} />
      </header>
      {agent.agent_status === "blocked" ? (
        <div className="attention-banner" role="status">
          <strong>Needs your input</strong>
          <span>The agent is waiting for a decision.</span>
        </div>
      ) : null}
      <section
        className={`output-panel output-panel--${view}`}
        aria-label={view === "chat" ? "Agent conversation" : "Terminal output"}
      >
        {view === "terminal" ? (
          <div className="output-panel__bar">
            <span>Agent output</span>
            <span>ANSI</span>
          </div>
        ) : null}
        {content}
      </section>
      {view === "terminal" ? (
        <div className="key-controls" aria-label="Terminal controls">
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
        </div>
      ) : null}
      {queueQuery.isError ? (
        <p role="alert" className="queued-prompts">
          Queue unavailable: {queueQuery.error.message}
        </p>
      ) : null}
      {queued.length ? (
        <section className="queued-prompts" aria-label="Fernblick queued messages">
          <strong>Fernblick queue · {queued.length}</strong>
          <small>
            Stored on this server, not in Pi’s queue. Resolve failed or uncertain messages to
            continue; temporary images may expire.
          </small>
          <ul role="list">
            {queued.map((item) => (
              <li key={item.id}>
                {item.state === "queued" && item.session === agent.agent_session?.value ? (
                  <button
                    type="button"
                    className="queued-prompts__edit"
                    disabled={Boolean(editingId)}
                    onClick={() => {
                      setEditingId(item.id);
                      setPrompt(item.text);
                      setEditingAttachments(item.attachments);
                    }}
                    aria-label={`Edit queued message: ${item.text || "image"}`}
                  >
                    {item.text || `${item.attachments.length} image(s)`}
                    {item.text && item.attachments.length
                      ? ` · ${item.attachments.length} image(s)`
                      : ""}
                  </button>
                ) : (
                  <span className="queued-prompts__edit">
                    {item.text || `${item.attachments.length} image(s)`}
                  </span>
                )}
                {item.state !== "queued" ? (
                  <span className="queued-prompts__state">{item.state}</span>
                ) : null}
                {item.session !== agent.agent_session?.value ? (
                  <small>Previous Pi session — this message will not be sent automatically.</small>
                ) : null}
                {item.error ? <small role="alert">{item.error}</small> : null}
                {(item.state === "failed" || item.state === "uncertain") &&
                item.session === agent.agent_session?.value ? (
                  <button
                    type="button"
                    disabled={queueAction.isPending}
                    onClick={() => {
                      if (
                        item.state === "uncertain" &&
                        !window.confirm(
                          "The agent may already have received this message. Retry anyway?",
                        )
                      )
                        return;
                      queueAction.mutate({ id: item.id, action: "retry" });
                    }}
                  >
                    Retry
                  </button>
                ) : null}
                {item.state === "submitted" || item.state === "uncertain" ? (
                  <button
                    type="button"
                    disabled={queueAction.isPending}
                    onClick={() => {
                      if (
                        window.confirm(
                          "Only clear this message if you verified it was delivered in the agent conversation. Continue?",
                        )
                      ) {
                        queueAction.mutate({ id: item.id, action: "ack" });
                      }
                    }}
                  >
                    Mark delivered
                  </button>
                ) : null}
                {item.state === "queued" || item.state === "failed" ? (
                  <button
                    type="button"
                    className="queued-prompts__remove"
                    aria-label={`Remove queued message: ${item.text || "image"}`}
                    disabled={queueAction.isPending}
                    onClick={() => {
                      if (editingId === item.id) {
                        setEditingId(null);
                        setEditingAttachments([]);
                        setPrompt("");
                      }
                      queueAction.mutate({ id: item.id, action: "remove" });
                    }}
                  >
                    <CloseIcon />
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <form className="prompt-composer" onSubmit={submit}>
        <div className="prompt-composer__surface">
          {editingAttachments.length || attachments.length ? (
            <div className="prompt-attachments" aria-label="Image attachments">
              {editingAttachments.map((id) => (
                <div className="prompt-attachment" key={id}>
                  <img src={`/api/uploads/${id}`} alt="Queued image" />
                  <button
                    type="button"
                    aria-label="Remove queued image"
                    onClick={() =>
                      setEditingAttachments((current) =>
                        current.filter((candidate) => candidate !== id),
                      )
                    }
                  >
                    <CloseIcon />
                  </button>
                </div>
              ))}
              {attachments.map((attachment) => (
                <div className="prompt-attachment" key={attachment.previewUrl}>
                  <img src={attachment.previewUrl} alt={attachment.file.name} />
                  <button
                    type="button"
                    aria-label={`Remove ${attachment.file.name}`}
                    onClick={() => {
                      URL.revokeObjectURL(attachment.previewUrl);
                      setAttachments((current) =>
                        current.filter((candidate) => candidate !== attachment),
                      );
                    }}
                  >
                    <CloseIcon />
                  </button>
                </div>
              ))}
            </div>
          ) : null}
          {editingId ? (
            <button
              type="button"
              className="queued-prompts__cancel"
              onClick={() => {
                attachments.forEach((attachment) => URL.revokeObjectURL(attachment.previewUrl));
                setAttachments([]);
                setEditingAttachments([]);
                setEditingId(null);
                setPrompt("");
              }}
            >
              Cancel editing
            </button>
          ) : null}
          <label htmlFor="agent-prompt" className="sr-only">
            Message {getAgentTabLabel(agent)}
          </label>
          <div className="prompt-composer__row">
            <input
              ref={fileInputRef}
              className="sr-only"
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              multiple
              onChange={(event) => selectImages(event.target.files)}
            />
            <button
              type="button"
              className="prompt-composer__attach"
              aria-label="Attach images"
              disabled={
                attachments.length + editingAttachments.length >= 4 || queueMutation.isPending
              }
              onClick={() => fileInputRef.current?.click()}
            >
              <ImageIcon />
            </button>
            {agent.agent === "pi" && agent.agent_session?.kind === "path" ? (
              <button
                type="button"
                className="prompt-composer__tree"
                aria-label="Open conversation paths"
                title="Conversation paths"
                onClick={() => setTreeOpen(true)}
              >
                <BranchIcon />
              </button>
            ) : null}
            <textarea
              id="agent-prompt"
              value={prompt}
              disabled={queueMutation.isPending}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder={`Send to ${getAgentTabLabel(agent)}…`}
              rows={1}
              maxLength={32000}
            />
            <button
              type="submit"
              aria-label={editingId ? "Save queued message" : "Send message"}
              disabled={
                (!prompt.trim() && !attachments.length && !editingAttachments.length) ||
                queueMutation.isPending
              }
            >
              <SendIcon />
            </button>
          </div>
        </div>
        {queueMutation.isError ? <p role="alert">{queueMutation.error.message}</p> : null}
        {queueAction.isError ? <p role="alert">{queueAction.error.message}</p> : null}
        {keyMutation.isError ? <p role="alert">{keyMutation.error.message}</p> : null}
      </form>
      {view === "chat" && transcriptQuery.data ? (
        <div className="pi-status-line" aria-label="Pi session status">
          {(transcriptQuery.data.status.nativeLines?.length ?? 0) >= 2 ? (
            transcriptQuery.data.status.nativeLines?.map((line) => <span key={line}>{line}</span>)
          ) : (
            <>
              <span>
                {transcriptQuery.data.status.model ?? "Unknown model"} ·{" "}
                {transcriptQuery.data.status.cwd}
              </span>
              <span>
                {transcriptQuery.data.status.totalTokens.toLocaleString()} tokens · $
                {transcriptQuery.data.status.cost.toFixed(2)}
                {transcriptQuery.data.status.provider
                  ? ` · ${transcriptQuery.data.status.provider}`
                  : ""}
              </span>
            </>
          )}
        </div>
      ) : null}
      <ConversationTreeDialog
        open={treeOpen}
        target={target}
        onClose={() => setTreeOpen(false)}
        onRestorePrompt={setPrompt}
      />
      {lightboxImage ? (
        <dialog
          ref={lightboxRef}
          className="image-lightbox"
          aria-label="Image preview"
          onClose={() => setLightboxImage(null)}
          onClick={(event) => {
            if (event.target === event.currentTarget) event.currentTarget.close();
          }}
        >
          <button
            type="button"
            className="image-lightbox__close"
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
