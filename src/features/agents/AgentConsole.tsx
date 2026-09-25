import { useEffect, useRef, useState, type FormEvent, type RefObject } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Agent, KeyName } from "../../shared/api/contracts";
import { getAgentTabLabel, getAgentTarget, getStatusLabel } from "./agentPresentation";
import {
  getAgentOutput,
  getAgentTranscript,
  promptAgent,
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
type QueuedPrompt = { id: string; text: string; attachments: PendingAttachment[] };
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
  const [queued, setQueued] = useState<QueuedPrompt[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [queuePaused, setQueuePaused] = useState(false);
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);
  const [treeOpen, setTreeOpen] = useState(false);
  const [showThinking, setShowThinking] = useState(initialShowThinking);
  const transcriptInitializing = agent.agent === "pi" && !agent.agent_session;
  const nextQueuedId = useRef(0);
  const lightboxRef = useRef<HTMLDialogElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const outputRef = useRef<HTMLElement>(null);
  const shouldFollowRef = useRef(true);
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
  useEffect(() => {
    if (!queued.length) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [queued.length]);
  useEffect(() => {
    if (lightboxImage && lightboxRef.current && !lightboxRef.current.open) {
      lightboxRef.current.showModal();
    }
  }, [lightboxImage]);
  const promptMutation = useMutation({
    mutationFn: async ({
      text,
      files,
    }: {
      text: string;
      files: File[];
      previews?: PendingAttachment[];
    }) => {
      const uploaded = await Promise.all(files.map(uploadImage));
      return promptAgent(
        target,
        text,
        uploaded.map((image) => image.id),
      );
    },
    onSuccess: (_result, sent) => {
      sent.files.forEach((file) => {
        const attachment = sent.previews?.find((candidate) => candidate.file === file);
        if (attachment) URL.revokeObjectURL(attachment.previewUrl);
      });
      shouldFollowRef.current = true;
      void queryClient.invalidateQueries({ queryKey: ["agent-output", target] });
      void queryClient.invalidateQueries({ queryKey: ["agent-transcript", target] });
      void queryClient.invalidateQueries({ queryKey: ["agents"] });
    },
  });
  const { mutate: sendPrompt, isPending: sendingPrompt } = promptMutation;
  useEffect(() => {
    if (agent.agent_status !== "idle" && agent.agent_status !== "done") return;
    if (sendingPrompt || queuePaused || !queued.length) return;
    const next = queued[0];
    if (next.id === editingId) return;
    const timer = window.setTimeout(() => {
      setQueued((current) => current.slice(1));
      sendPrompt(
        {
          text: next.text,
          files: next.attachments.map((attachment) => attachment.file),
          previews: next.attachments,
        },
        {
          onError: () => {
            setQueuePaused(true);
            setQueued((current) => [next, ...current]);
          },
        },
      );
    }, 0);
    return () => window.clearTimeout(timer);
  }, [agent.agent_status, queued, sendingPrompt, editingId, queuePaused, sendPrompt]);
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
    if (!prompt.trim() && !attachments.length) return;
    if (editingId) {
      setQueued((current) =>
        current.map((item) =>
          item.id === editingId ? { ...item, text: prompt, attachments } : item,
        ),
      );
      setEditingId(null);
    } else {
      setQueued((current) => [
        ...current,
        { id: String(++nextQueuedId.current), text: prompt, attachments },
      ]);
    }
    setQueuePaused(false);
    setPrompt("");
    setAttachments([]);
  }
  function selectImages(files: FileList | null) {
    if (!files) return;
    const accepted = Array.from(files)
      .filter((file) => ["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type))
      .filter((file) => file.size <= 10 * 1024 * 1024);
    setAttachments((current) => [
      ...current,
      ...accepted.slice(0, Math.max(0, 4 - current.length)).map((file) => ({
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
      {queued.length ? (
        <section className="queued-prompts" aria-label="Fernblick queued messages">
          <strong>Fernblick queue · {queued.length}</strong>
          <small>
            Keep this conversation open until these messages send. They are not in Pi’s queue.
          </small>
          {queuePaused ? (
            <button type="button" onClick={() => setQueuePaused(false)}>
              Retry sending
            </button>
          ) : null}
          <ul>
            {queued.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className="queued-prompts__edit"
                  onClick={() => {
                    if (editingId) return;
                    setEditingId(item.id);
                    setPrompt(item.text);
                    setAttachments(item.attachments);
                  }}
                  aria-label={`Edit queued message: ${item.text || "image"}`}
                >
                  {item.text || `${item.attachments.length} image(s)`}
                  {item.attachments.length && item.text
                    ? ` · ${item.attachments.length} image(s)`
                    : ""}
                </button>
                <button
                  type="button"
                  aria-label="Remove queued message"
                  onClick={() => {
                    item.attachments.forEach((attachment) =>
                      URL.revokeObjectURL(attachment.previewUrl),
                    );
                    setQueued((current) => current.filter((candidate) => candidate.id !== item.id));
                    if (editingId === item.id) {
                      setEditingId(null);
                      setPrompt("");
                      setAttachments([]);
                    }
                  }}
                >
                  <CloseIcon />
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <form className="prompt-composer" onSubmit={submit}>
        <div className="prompt-composer__surface">
          {attachments.length ? (
            <div className="prompt-attachments" aria-label="Image attachments">
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
                      if (editingId) {
                        setQueued((current) =>
                          current.map((item) =>
                            item.id === editingId
                              ? {
                                  ...item,
                                  attachments: item.attachments.filter(
                                    (candidate) => candidate !== attachment,
                                  ),
                                }
                              : item,
                          ),
                        );
                      }
                    }}
                  >
                    <CloseIcon />
                  </button>
                </div>
              ))}
            </div>
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
              disabled={attachments.length >= 4}
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
              onChange={(event) => setPrompt(event.target.value)}
              placeholder={`Send to ${getAgentTabLabel(agent)}…`}
              rows={1}
              maxLength={32000}
            />
            <button
              type="submit"
              aria-label={editingId ? "Save queued message" : "Send message"}
              disabled={!prompt.trim() && !attachments.length}
            >
              <SendIcon />
            </button>
          </div>
        </div>
        {promptMutation.isError ? <p role="alert">{promptMutation.error.message}</p> : null}
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
