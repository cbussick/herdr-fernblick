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
import { BoardController } from "./BoardController";
import { downloadScene } from "./scene";
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
  agentName: string;
  agentContext?: string;
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
  agentName,
  agentContext,
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
  const operation = useRef(false);
  const backButton = useRef<HTMLButtonElement>(null);
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
            !element.matches('[data-ui="app-status"]') &&
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
      const appStatus = document.querySelector<HTMLElement>('[data-ui="app-status"]');
      if (
        event.key === "Escape" &&
        !nativeDialog &&
        !(event.target instanceof Node && appStatus?.contains(event.target))
      ) {
        event.preventDefault();
        dismiss.current();
      }
      if (event.key !== "Tab") return;
      const scope = nativeDialog ?? modal;
      // The global notice is a sibling body portal so it stays actionable while
      // the app root is inert. Include it in this modal's normal Tab order, but
      // keep nested Excalidraw/image dialogs in control of their own focus.
      const scopes = (!nativeDialog && appStatus ? [modal, appStatus] : [scope]).sort(
        (left, right) =>
          left.compareDocumentPosition(right) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
      );
      const containsFocus = scopes.some((element) => element.contains(document.activeElement));
      const controls = scopes
        .flatMap((element) =>
          Array.from(
            element.querySelectorAll<HTMLElement>(
              "button, a[href], input, textarea, select, [tabindex]:not([tabindex='-1'])",
            ),
          ),
        )
        .filter(
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
      } else if (event.shiftKey && (document.activeElement === first || !containsFocus)) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !containsFocus)) {
        event.preventDefault();
        first.focus();
      }
    };
    if (modal) document.addEventListener("keydown", keydown);
    return () => {
      active.current = false;
      if (modal) document.removeEventListener("keydown", keydown);
      previous.forEach(([element, inert]) => {
        element.inert = inert;
      });
      if (focused instanceof HTMLElement) focused.focus();
    };
  }, [controller]);
  useEffect(() => {
    backButton.current?.focus();
  }, []);

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
              ? "Working"
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
  async function promptBoard() {
    if (
      operation.current ||
      !available ||
      !structured ||
      !ready ||
      Boolean(editorError) ||
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
      if (current.current.editorError) throw new Error(current.current.editorError);
      const board = controller.state.board;
      if (!board) throw new Error("Board is not ready.");
      // Flush manual drawing first. The agent reads the latest scene/image on
      // demand through the same tools as terminal and ordinary chat requests.
      send({ boardId: board.id, revision: board.revision, text });
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
      void back();
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
        <header className={styles.header}>
          <button ref={backButton} type="button" onClick={() => void back()} disabled={working}>
            ← Back
          </button>
          <div className={styles.identity}>
            <h2 id="whiteboard-title">Whiteboard</h2>
            <span title={[agentName, agentContext].filter(Boolean).join(" · ")}>
              <strong>{agentName}</strong>
              {agentContext ? ` · ${agentContext}` : ""}
            </span>
          </div>
          <span className={styles["save-status"]} role="status">
            {state.saving ? "Saving…" : state.dirty ? "Unsynced" : "Saved"}
          </span>
        </header>
        <div className={styles.workspace} data-testid="whiteboard-workspace">
          <div className={styles.canvas} inert={working || undefined}>
            {state.scene ? (
              <EditorBoundary>
                <Suspense fallback={<p className={styles.notice}>Loading drawing tools…</p>}>
                  <Editor
                    scene={state.scene}
                    generation={state.generation}
                    locked={working}
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
            <button
              className={styles.fit}
              type="button"
              disabled={!ready || working}
              onClick={() => editor.current?.fit()}
            >
              Fit drawing
            </button>
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
            inert={false}
            activity={{
              message: status,
              warning,
              working: agentState === "working" && !problem && access?.state !== "pending",
              detail: (
                <>
                  {!structured ? <p>Run /reload in Pi to enable board editing.</p> : null}
                  {access && disconnected ? <p>Board access may still be active.</p> : null}
                  {state.storageError ? <p>{state.storageError}</p> : null}
                </>
              ),
              action: access ? (
                <button
                  type="button"
                  disabled={revoking || !state.connected}
                  onClick={() => void revoke()}
                >
                  {revoking ? "Stopping…" : "Stop access"}
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
                  <div className={styles.recovery}>
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
                  <div className={styles.recovery}>
                    <button type="button" onClick={() => void controller.refresh()}>
                      Reconnect board
                    </button>
                  </div>
                ) : null}
              </>
            }
          />
        </div>
      </div>
    </dialog>,
    document.body,
  );
}
