import a11yStyles from "../../styles/accessibility.module.css";
import consoleStyles from "./Console.module.css";
import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import type { Agent, KeyName } from "../../shared/api/contracts";
import { matchesTarget, targetOf, type Target } from "../../../packages/pi-live-chat/protocol";
import { getAgentTabLabel, getAgentTarget, getStatusLabel } from "./agentPresentation";
import { getAgentOutput, sendAgentKey, chatCommand, uploadImage } from "../../shared/api/apiClient";
import { useLiveChat } from "./useLiveChat";
import { ChatTranscript } from "./ChatTranscript";
import { PiSessionStatus } from "./PiSessionStatus";
import { TerminalOutput } from "./TerminalOutput";
import { useChatAnnotations } from "./useChatAnnotations";
import { AnnotationPopover, AnnotationSelectionAction, AnnotationTray } from "./ChatAnnotations";
import { annotationPrompt } from "./annotations";
import { CloseTabButton } from "./CloseTabButton";
import { ConversationTreeDialog } from "./ConversationTreeDialog";
import { SkillComposer } from "./SkillComposer";
import { Whiteboard } from "../whiteboard/Whiteboard";
import { boardApi } from "../whiteboard/boardApi";
import type { BoardPromptContext } from "../whiteboard/ConversationDock";
import { BackIcon, CloseIcon } from "../../shared/ui/Icons";
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
  annotationIds?: string[];
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
  const [chatImageOpen, setChatImageOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadedIds = useRef(new Map<File, string>());
  const previews = useRef(new Set<string>());
  const [view, setView] = useState<AgentView>("chat");
  const [showThinking, setShowThinking] = useState(initialShowThinking);
  const outputRef = useRef<HTMLElement>(null);
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
      if (draft.annotationIds) {
        annotations.acknowledge(draft.annotationIds);
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
  const annotations = useChatAnnotations(
    snapshot,
    view === "chat" && !treeTarget && !boardTarget && !chatImageOpen,
    outputRef,
    send.isPending,
  );
  const stop = useMutation({
    mutationFn: () => {
      if (!snapshot) throw new Error("Live chat unavailable");
      return chatCommand(agent.pane_id, targetOf(snapshot), "stop");
    },
    retry: false,
  });
  const resetStop = stop.reset;
  useEffect(() => {
    // Stop feedback belongs to this busy interval and live target only. Reset
    // also detaches late ACKs so they cannot leak into a subsequent run.
    resetStop();
  }, [
    snapshot?.busy,
    snapshot?.identity.runtime,
    snapshot?.identity.sessionId,
    snapshot?.epoch,
    resetStop,
  ]);
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
  const composerSending = send.isPending;
  const canForward = Boolean(
    snapshot &&
    snapshot.version === 2 &&
    !live.error &&
    !snapshot.busy &&
    !snapshot.sendPending &&
    !send.isPending,
  );
  const canSend =
    canForward &&
    !annotations.editor &&
    (!prompt.trimStart().startsWith("/skill:") || Boolean(snapshot?.capabilities?.skills)) &&
    Boolean(prompt.trim() || attachments.length);
  const canSendAnnotations =
    canForward && annotations.entries.length > 0 && !annotations.stale && !annotations.editor;
  function sendAnnotations() {
    if (!canSendAnnotations || !annotations.owner) return;
    send.mutate({
      text: annotationPrompt(annotations.entries),
      attachments: [],
      target: annotations.owner,
      annotationIds: annotations.entries.map((entry) => entry.id),
    });
  }
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
      {view === "chat" && snapshot ? (
        <span role="status" className={a11yStyles["sr-only"]}>
          {annotations.notice}
        </span>
      ) : null}
      <section
        className={consoleStyles["output-panel"] + " " + consoleStyles[`output-panel--${view}`]}
        data-testid="output-panel"
        data-view={view}
        aria-label={view === "chat" ? "Agent conversation" : "Terminal output"}
      >
        {view === "terminal" ? (
          <TerminalOutput
            key={JSON.stringify([agent.pane_id, agent.agent_session?.value])}
            queryKey={["agent-output", agent.pane_id, agent.agent_session?.value ?? ""]}
            read={(source, signal) => getAgentOutput(agent.pane_id, source, signal)}
            canLoadHistory={agent.agent_status === "idle" || agent.agent_status === "done"}
          />
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
            transcriptRef={outputRef}
            annotations={annotations.stale ? [] : annotations.entries}
            interacting={annotations.interacting}
            onAnnotationEdit={
              annotations.canBegin
                ? (id, anchor) => {
                    const entry = annotations.entries.find((value) => value.id === id);
                    if (entry) annotations.edit(entry, anchor);
                  }
                : undefined
            }
            onImageOpenChange={setChatImageOpen}
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
      {view === "chat" ? (
        <AnnotationTray
          annotations={annotations}
          canSend={canSendAnnotations}
          canAdd={!live.error && annotations.canAddGeneral}
          sending={composerSending && Boolean(send.variables?.annotationIds)}
          locked={composerSending}
          blockedReason={
            live.error
              ? "Reconnect to Pi before sending comments."
              : !snapshot || snapshot.version !== 2
                ? "An up-to-date Pi connection is required to send comments."
                : snapshot.busy || snapshot.sendPending
                  ? "You can keep annotating. Send when the agent is idle."
                  : annotations.editor
                    ? "Save or cancel the open comment before sending."
                    : ""
          }
          sendError={send.isError && send.variables?.annotationIds ? send.error.message : undefined}
          onSend={sendAnnotations}
        />
      ) : null}
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
            <input
              ref={fileInputRef}
              className={a11yStyles["sr-only"]}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              multiple
              disabled={composerSending}
              onChange={(event) => selectImages(event.target.files)}
            />
            <SkillComposer
              pane={agent.pane_id}
              target={snapshot ? targetOf(snapshot) : undefined}
              available={Boolean(snapshot?.capabilities?.skills)}
              connected={Boolean(snapshot && !live.error)}
              prompt={prompt}
              onChange={changePrompt}
              label={getAgentTabLabel(agent)}
              sending={composerSending}
              canSend={canSend}
              canAttach={attachments.length < 4}
              canOpenTree={Boolean(snapshot && !live.error && !annotations.editor)}
              onAttach={() => fileInputRef.current?.click()}
              onOpenTree={() => snapshot && setTreeTarget(targetOf(snapshot))}
              canOpenBoard={Boolean(snapshot?.version === 2 && !live.error && !annotations.editor)}
              onOpenBoard={() => snapshot && setBoardTarget(targetOf(snapshot))}
            />
          </div>
          {attachmentError ? (
            <StateNotice kind="info" role="alert">
              {attachmentError}
            </StateNotice>
          ) : null}
          {send.isError && !send.variables?.annotationIds ? (
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
      {view === "chat" && snapshot && !live.error ? (
        <PiSessionStatus status={snapshot.status} />
      ) : null}
      {annotations.selection ? <AnnotationSelectionAction annotations={annotations} /> : null}
      {view === "chat" && annotations.editor ? (
        <AnnotationPopover annotations={annotations} />
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
