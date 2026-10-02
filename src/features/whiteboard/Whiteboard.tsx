import {
  Component,
  Suspense,
  lazy,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import type { BoardTarget } from "../../../packages/pi-live-chat/boardProtocol";
import { uploadImage } from "../../shared/api/apiClient";
import { BoardController } from "./BoardController";
import { boardApi, requestId } from "./boardApi";
import { downloadScene, sceneFingerprint } from "./scene";
import type { EditorHandle } from "./BoardEditor";
import { ConversationDock, type WhiteboardConversation } from "./ConversationDock";
import styles from "./Whiteboard.module.css";

// No runtime Excalidraw import may precede this assignment. The fonts are
// served locally; never rely on the vendor's CDN fallback.
const Editor = lazy(() => {
  (window as Window & { EXCALIDRAW_ASSET_PATH?: string }).EXCALIDRAW_ASSET_PATH = "/excalidraw/";
  return import("./BoardEditor");
});
class EditorBoundary extends Component<{ children: ReactNode }, { error: boolean }> {
  state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  render() {
    return this.state.error ? (
      <p className={styles.notice} role="alert">
        The drawing editor could not load. Your saved drawing is retained. Close and reopen to try
        again.
      </p>
    ) : (
      this.props.children
    );
  }
}
export interface WhiteboardProps {
  pane: string;
  target: BoardTarget;
  agentState: "ready" | "waiting" | "working" | "disconnected" | "unsupported";
  structured: boolean;
  conversation: WhiteboardConversation;
  onClose: () => void;
}
export function Whiteboard(props: WhiteboardProps) {
  const { pane, target } = props;
  const [controller, setController] = useState<BoardController | null>(null);
  useEffect(() => {
    const owner = new BoardController(pane, target);
    // Each effect lifetime needs a fresh owner, including StrictMode replay.
    // oxlint-disable-next-line react/set-state-in-effect
    setController(owner);
    void owner.start();
    return () => owner.dispose();
  }, [pane, target]);
  return controller ? (
    <WhiteboardSession key={JSON.stringify(controller.target)} {...props} controller={controller} />
  ) : null;
}
function WhiteboardSession({
  pane,
  target,
  agentState,
  structured,
  conversation,
  onClose,
  controller,
}: WhiteboardProps & { controller: BoardController }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const available = agentState === "ready";
  const dialog = useRef<HTMLDialogElement>(null);
  const editor = useRef<EditorHandle | null>(null);
  const active = useRef(false);
  const [sheet, setSheet] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [editorError, setEditorError] = useState("");
  const current = useRef({ available, structured, target, editorError });
  useLayoutEffect(() => {
    current.current = { available, structured, target, editorError };
  });
  const [leave, setLeave] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [ready, setReady] = useState(false);
  const [preview, setPreview] = useState<{
    blob: Blob;
    url: string;
    revision: number;
    fingerprint: string;
  } | null>(null);
  const sendAbort = useRef<AbortController | null>(null);
  const operation = useRef(false);
  const backButton = useRef<HTMLButtonElement>(null);
  const instructionInput = useRef<HTMLTextAreaElement>(null);
  const dismiss = useRef<() => void>(() => {});

  useEffect(() => {
    active.current = true;
    const focused = document.activeElement;
    const modal = dialog.current;
    // Native Excalidraw dialogs portal to body. A top-layer showModal() would
    // make those dialogs inert, so this body portal supplies modality instead.
    const background = modal
      ? Array.from(document.body.children).filter(
          (element): element is HTMLElement =>
            element instanceof HTMLElement &&
            element !== modal &&
            !element.classList.contains("excalidraw"),
        )
      : [];
    const previous = background.map((element) => [element, element.inert] as const);
    background.forEach((element) => {
      element.inert = true;
    });
    const keydown = (event: KeyboardEvent) => {
      if (!modal || event.defaultPrevented) return;
      const nativeDialog = document.querySelector<HTMLElement>(
        "[class~=excalidraw-modal-container] [role=dialog], dialog[data-ui=chat-image-preview][open]",
      );
      if (event.key === "Escape" && !nativeDialog) {
        event.preventDefault();
        dismiss.current();
      }
      if (event.key !== "Tab") return;
      const scope = nativeDialog ?? modal;
      const controls = Array.from(
        scope.querySelectorAll<HTMLElement>(
          "button, a[href], input, textarea, select, [tabindex]:not([tabindex='-1'])",
        ),
      ).filter(
        (element) =>
          !element.matches(":disabled") &&
          !element.closest("[inert]") &&
          element.getClientRects().length > 0,
      );
      const first = controls[0];
      const last = controls.at(-1);
      if (!first) {
        event.preventDefault();
        scope.focus();
      } else if (
        event.shiftKey &&
        (document.activeElement === first || !scope.contains(document.activeElement))
      ) {
        event.preventDefault();
        last?.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last || !scope.contains(document.activeElement))
      ) {
        event.preventDefault();
        first.focus();
      }
    };
    if (modal) document.addEventListener("keydown", keydown);
    return () => {
      active.current = false;
      sendAbort.current?.abort();
      if (modal) document.removeEventListener("keydown", keydown);
      previous.forEach(([element, inert]) => {
        element.inert = inert;
      });
      if (focused instanceof HTMLElement) focused.focus();
    };
  }, [controller]);
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview.url);
    },
    [preview],
  );
  useEffect(() => {
    if (sheet) instructionInput.current?.focus();
    else backButton.current?.focus();
  }, [sheet, working]);

  useEffect(() => {
    const viewport = window.visualViewport;
    const element = dialog.current;
    if (!viewport || !element) return;
    // Mobile keyboards can resize only the visual viewport, not CSS dvh.
    const resize = () => {
      element.style.height = `${viewport.height}px`;
      element.style.top = `${viewport.offsetTop}px`;
    };
    resize();
    viewport.addEventListener("resize", resize);
    viewport.addEventListener("scroll", resize);
    return () => {
      viewport.removeEventListener("resize", resize);
      viewport.removeEventListener("scroll", resize);
    };
  }, []);

  function assertTarget() {
    const now = current.current;
    if (
      !active.current ||
      !now.available ||
      now.target.runtime !== controller.target.runtime ||
      now.target.epoch !== controller.target.epoch ||
      now.target.sessionId !== controller.target.sessionId
    )
      throw new Error(
        "The agent is busy, disconnected, or this session changed. Nothing further was sent.",
      );
    if (!controller.state.connected || controller.state.conflict)
      throw new Error("Whiteboard is disconnected or has a save conflict.");
  }
  const empty = !state.scene?.elements.some((element) => !element.isDeleted);
  const disabled =
    !available ||
    !state.connected ||
    state.conflict ||
    empty ||
    !ready ||
    working ||
    Boolean(editorError);
  const previewStale = Boolean(
    preview &&
    (state.dirty ||
      preview.revision !== state.board?.revision ||
      (state.scene && preview.fingerprint !== sceneFingerprint(state.scene))),
  );

  const access = state.board?.access;
  const disconnected = agentState === "disconnected" || (Boolean(state.board) && !state.connected);
  const activity =
    agentState === "disconnected"
      ? "Connection lost. Sending is paused."
      : agentState === "unsupported"
        ? "Run /reload in Pi to enable sending."
        : access?.state === "pending"
          ? `Waiting for agent to ${access.mode === "edit" ? "edit" : "inspect"}…`
          : agentState === "waiting"
            ? "Waiting for agent…"
            : agentState === "working"
              ? "Agent is working"
              : "";
  const problem = conversation.error || error || editorError || state.error;
  const status = problem || activity;
  const warning = Boolean(
    problem || state.storageError || disconnected || agentState === "unsupported",
  );

  async function back() {
    if (operation.current) return;
    if (
      editorError &&
      !window.confirm(
        "Some changes cannot be saved. Download your current drawing from the canvas menu first. Leave and discard unsupported changes?",
      )
    )
      return;
    operation.current = true;
    setWorking(true);
    try {
      await controller.flush();
      // Persist the instruction as well; a server save alone cannot store it.
      if (state.instruction) await controller.keepLocal();
      if (active.current) onClose();
    } catch (reason) {
      if (active.current) {
        setError(reason instanceof Error ? reason.message : "Could not save your drawing");
        setLeave(true);
      }
    } finally {
      operation.current = false;
      if (active.current) setWorking(false);
    }
  }
  async function prepare() {
    if (disabled || operation.current) return;
    operation.current = true;
    setSheet(true);
    setPreview(null);
    setError("");
    setWorking(true);
    try {
      assertTarget();
      await controller.flush();
      const fingerprint = sceneFingerprint(controller.state.scene!);
      const blob = await editor.current!.exportPNG();
      assertTarget();
      if (fingerprint !== sceneFingerprint(controller.state.scene!))
        throw new Error(
          "The drawing changed while preparing the preview. Close this sheet and prepare it again.",
        );
      await controller.flush();
      assertTarget();
      setPreview({
        blob,
        url: URL.createObjectURL(blob),
        revision: controller.state.board!.revision,
        fingerprint,
      });
    } catch (reason) {
      if (active.current)
        setError(reason instanceof Error ? reason.message : "Could not prepare the image");
    } finally {
      operation.current = false;
      if (active.current) setWorking(false);
    }
  }
  async function submit() {
    if (disabled || !preview || operation.current) return;
    operation.current = true;
    setWorking(true);
    setError("");
    const abort = new AbortController();
    sendAbort.current = abort;
    function validatePreview() {
      assertTarget();
      if (
        controller.state.dirty ||
        controller.state.board!.revision !== preview!.revision ||
        sceneFingerprint(controller.state.scene!) !== preview!.fingerprint
      )
        throw new Error(
          "The board changed. Close this sheet and preview the latest drawing before sending.",
        );
    }
    try {
      validatePreview();
      const upload = await uploadImage(
        new File([preview.blob], "whiteboard.png", { type: "image/png" }),
      );
      validatePreview(); // Revalidate runtime/epoch, access and revision after upload.
      await boardApi.send(
        pane,
        {
          target: controller.target,
          boardId: controller.state.board!.id,
          revision: preview.revision,
          uploadId: upload.id,
          mode: "image",
          text: controller.state.instruction,
          requestId: requestId(),
        },
        AbortSignal.any([abort.signal, AbortSignal.timeout(15000)]),
      );
      if (!active.current) return;
      controller.instruct("");
      setSheet(false);
      setPreview(null);
      await controller.refresh();
    } catch (reason) {
      if (active.current)
        setError(
          `${reason instanceof Error ? reason.message : "Send failed"} Drawing and instruction retained. No automatic retry.`,
        );
    } finally {
      operation.current = false;
      if (active.current) setWorking(false);
    }
  }
  async function promptBoard() {
    if (
      operation.current ||
      !available ||
      !structured ||
      !ready ||
      Boolean(editorError) ||
      sheet ||
      conversation.sending ||
      !conversation.draft.trim()
    )
      return;
    const text = conversation.draft;
    const send = conversation.onSend;
    operation.current = true;
    setWorking(true);
    setError("");
    try {
      assertTarget();
      await controller.flush();
      assertTarget();
      if (!current.current.structured)
        throw new Error("Run /reload in Pi to enable board editing.");
      const board = controller.state.board;
      const scene = controller.state.scene;
      if (!board || !scene) throw new Error("Board is not ready.");
      const fingerprint = sceneFingerprint(scene);
      const validate = () => {
        assertTarget();
        if (!current.current.structured)
          throw new Error("Run /reload in Pi to enable board editing.");
        if (current.current.editorError) throw new Error(current.current.editorError);
        if (
          controller.state.dirty ||
          controller.state.board?.revision !== board.revision ||
          !controller.state.scene ||
          sceneFingerprint(controller.state.scene) !== fingerprint
        )
          throw new Error(
            "The board changed while preparing the image. Review it before sending again.",
          );
      };
      let uploadId: string | undefined;
      if (scene.elements.some((element) => !element.isDeleted)) {
        const blob = await editor.current!.exportPNG();
        validate();
        const abort = new AbortController();
        sendAbort.current = abort;
        const upload = await uploadImage(
          new File([blob], "whiteboard.png", { type: "image/png" }),
          AbortSignal.any([abort.signal, AbortSignal.timeout(15000)]),
        );
        uploadId = upload.id;
      }
      // Never forward text/grant alone when a nonempty board export/upload fails,
      // or send an image of an older revision after an asynchronous boundary.
      validate();
      send({
        boardId: board.id,
        revision: board.revision,
        text,
        ...(uploadId ? { uploadId } : {}),
      });
    } catch (reason) {
      if (active.current)
        setError(
          `${reason instanceof Error ? reason.message : "Could not prepare board prompt"} Draft retained. No automatic retry.`,
        );
    } finally {
      operation.current = false;
      if (active.current) setWorking(false);
    }
  }
  async function revoke() {
    setRevoking(true);
    setError("");
    try {
      await controller.revoke();
    } catch (reason) {
      if (active.current)
        setError(reason instanceof Error ? reason.message : "Could not stop editing");
    } finally {
      if (active.current) setRevoking(false);
    }
  }

  useLayoutEffect(() => {
    dismiss.current = () => {
      if (working) return;
      if (sheet) {
        setSheet(false);
        setPreview(null);
      } else void back();
    };
  });
  return createPortal(
    <dialog
      open
      ref={dialog}
      className={styles.dialog}
      aria-modal="true"
      aria-labelledby="whiteboard-title"
      data-testid="whiteboard"
      tabIndex={-1}
      onCancel={(event) => {
        if (event.target !== event.currentTarget) return;
        event.preventDefault();
        dismiss.current();
      }}
    >
      <div className={styles.layout}>
        <header className={styles.header} inert={sheet || undefined}>
          <button ref={backButton} type="button" onClick={() => void back()} disabled={working}>
            ← Back
          </button>
          <div>
            <h2 id="whiteboard-title">Whiteboard</h2>
            <span>
              {state.saving ? "Saving…" : state.dirty ? "Unsynced drawing" : "Saved drawing"}
            </span>
          </div>
          <button
            type="button"
            className={styles.primary}
            disabled={disabled}
            onClick={() => void prepare()}
          >
            Share drawing
          </button>
        </header>
        <div className={styles.workspace} data-testid="whiteboard-workspace">
          <div className={styles.canvas} inert={sheet || working || undefined}>
            {state.scene ? (
              <EditorBoundary>
                <Suspense fallback={<p className={styles.notice}>Loading drawing tools…</p>}>
                  <Editor
                    scene={state.scene}
                    generation={state.generation}
                    locked={sheet || working}
                    onChange={(scene) => controller.change(scene)}
                    onError={setEditorError}
                    onInteraction={controller.interaction}
                    onReady={(handle) => {
                      editor.current = handle;
                      setReady(Boolean(handle));
                    }}
                  />
                </Suspense>
              </EditorBoundary>
            ) : (
              <p className={styles.notice}>Opening saved whiteboard…</p>
            )}
          </div>
          <ConversationDock
            conversation={{
              ...conversation,
              sending: conversation.sending || working,
              onSend: () => void promptBoard(),
            }}
            disabled={
              !available ||
              !ready ||
              working ||
              !structured ||
              !state.connected ||
              state.conflict ||
              Boolean(editorError)
            }
            inert={sheet}
            activity={{
              message: status,
              warning,
              working: agentState === "working" && !problem && access?.state !== "pending",
              detail: (
                <>
                  {!structured ? <p>Run /reload in Pi to enable board editing.</p> : null}
                  {access ? (
                    <p>
                      {disconnected
                        ? `${access.mode === "edit" ? "Editing" : "Inspection"} permission may still be active.`
                        : access.state === "active"
                          ? `Agent can ${access.mode === "edit" ? "edit" : "inspect"} this board`
                          : null}
                    </p>
                  ) : null}
                  {state.storageError ? <p>{state.storageError}</p> : null}
                </>
              ),
              action: access ? (
                <button
                  type="button"
                  disabled={revoking || !state.connected}
                  onClick={() => void revoke()}
                >
                  {revoking ? "Stopping…" : access.mode === "edit" ? "Stop editing" : "Stop access"}
                </button>
              ) : null,
            }}
            recovery={
              <>
                {state.recovery ? (
                  <button type="button" onClick={() => downloadScene(state.recovery!)}>
                    Download previous local drawing
                  </button>
                ) : null}
                {state.conflict || leave ? (
                  <div className={styles.recovery} inert={sheet || undefined}>
                    {state.scene ? (
                      <button type="button" onClick={() => downloadScene(state.scene!)}>
                        Download my drawing
                      </button>
                    ) : null}
                    <button
                      type="button"
                      disabled={working}
                      onClick={() => {
                        if (
                          !window.confirm(
                            "Replace your local drawing with the latest server board? Download your drawing first if you want to keep it.",
                          )
                        )
                          return;
                        void controller
                          .loadLatest()
                          .then(() => {
                            setError("");
                            setLeave(false);
                          })
                          .catch((reason: unknown) =>
                            setError(
                              reason instanceof Error ? reason.message : "Could not load board",
                            ),
                          );
                      }}
                    >
                      Load latest (replace mine)
                    </button>
                    {leave ? (
                      <button
                        type="button"
                        disabled={working}
                        onClick={() => {
                          void controller
                            .keepLocal()
                            .then(onClose)
                            .catch(() =>
                              setError(
                                "Local storage failed. Download your drawing before leaving.",
                              ),
                            );
                        }}
                      >
                        Leave with locally saved draft
                      </button>
                    ) : null}
                  </div>
                ) : null}
                {!state.connected && !state.conflict ? (
                  <div className={styles.recovery} inert={sheet || undefined}>
                    <button type="button" onClick={() => void controller.refresh()}>
                      Reconnect board
                    </button>
                  </div>
                ) : null}
              </>
            }
            history={
              state.board?.snapshots.length ? (
                <details className={styles.history} inert={sheet || undefined}>
                  <summary>Saved snapshots ({state.board.snapshots.length})</summary>
                  <p className={styles.notice}>
                    Captured before forwarding; a saved snapshot does not confirm delivery.
                  </p>
                  <ul>
                    {state.board.snapshots.map((snapshot) => {
                      const base = `/api/boards/${state.board!.id}/snapshots/${snapshot.id}`;
                      return (
                        <li key={snapshot.id}>
                          <a href={`${base}.png`} target="_blank" rel="noreferrer">
                            <img
                              src={`${base}.png`}
                              alt={`Captured drawing, revision ${snapshot.revision}`}
                              loading="lazy"
                            />
                            <span>{new Date(snapshot.createdAt).toLocaleString()}</span>
                          </a>
                          <a href={`${base}.json`} download>
                            Scene JSON
                          </a>
                        </li>
                      );
                    })}
                  </ul>
                </details>
              ) : null
            }
          />
        </div>
        {sheet ? (
          <div className={styles.scrim}>
            <section
              className={styles.sheet}
              role="region"
              aria-labelledby="whiteboard-send-title"
              aria-busy={working}
              tabIndex={-1}
            >
              <header>
                <h3 id="whiteboard-send-title">Send this drawing</h3>
                <button
                  type="button"
                  disabled={working}
                  onClick={() => {
                    setSheet(false);
                    setPreview(null);
                  }}
                >
                  Cancel
                </button>
              </header>
              {preview ? (
                <img
                  className={styles.preview}
                  src={preview.url}
                  alt="Full drawing preview to send"
                />
              ) : (
                <p>
                  {working
                    ? "Preparing PNG and loading fonts…"
                    : "Preview unavailable. Close this sheet to try again."}
                </p>
              )}
              <label className={styles.instruction}>
                Instruction <span>(optional)</span>
                <textarea
                  ref={instructionInput}
                  value={state.instruction}
                  maxLength={29000}
                  rows={3}
                  disabled={working}
                  onChange={(event) => controller.instruct(event.target.value)}
                  placeholder="What should the agent do with this drawing?"
                />
              </label>
              <p>Image only. Sharing does not grant live board access.</p>
              <p>PNG of the full drawing · white background · no embedded scene</p>
              {error ? <p role="alert">{error}</p> : null}
              {previewStale ? (
                <p role="alert">
                  The board changed. Cancel and preview the latest drawing before sending.
                </p>
              ) : null}
              <button
                type="button"
                className={styles.primary}
                disabled={disabled || !preview || previewStale}
                onClick={() => void submit()}
              >
                {working ? "Preparing / sending…" : "Send drawing"}
              </button>
            </section>
          </div>
        ) : null}
      </div>
    </dialog>,
    document.body,
  );
}
