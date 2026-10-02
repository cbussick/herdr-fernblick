import type {
  BoardScene,
  BoardState,
  BoardTarget,
} from "../../../packages/pi-live-chat/boardProtocol";
import { ApiError } from "../../shared/api/apiClient";
import { boardApi, type BoardEvent } from "./boardApi";
import { draftStore, type DraftStore, type LocalDraft } from "./draftStore";
import { canonical, mergeScene } from "./mergeScene";

export interface BoardView {
  board?: BoardState;
  scene?: BoardScene;
  recovery?: BoardScene;
  instruction: string;
  generation: number;
  dirty: boolean;
  saving: boolean;
  connected: boolean;
  conflict: boolean;
  error: string;
  storageError: string;
}
const message = (error: unknown) =>
  error instanceof Error ? error.message : "Whiteboard unavailable";

/** One owner per target. Only explicit pre-write CAS rejection permits reconciliation. */
export class BoardController {
  state: BoardView = {
    instruction: "",
    generation: 0,
    dirty: false,
    saving: false,
    connected: false,
    conflict: false,
    error: "",
    storageError: "",
  };
  private listeners = new Set<() => void>();
  private abort = new AbortController();
  private disposed = false;
  private timer?: ReturnType<typeof setTimeout>;
  private closeEvents?: () => void;
  private pendingSave?: Promise<void>;
  private pendingRead?: Promise<void>;
  private readAgain = false;
  private persistence: Promise<void> = Promise.resolve();
  private queuedDraft?: LocalDraft;
  private persisting = false;
  private editVersion = 0;
  private initialized = false;
  private interacting = false;
  private remote?: BoardState;
  // Persisted before sending a write: reload cannot replay an in-flight/uncertain save.
  private paused = false;
  private loadingLatest = false;
  private key: string;
  readonly pane: string;
  readonly target: BoardTarget;
  private api: typeof boardApi;
  private store: DraftStore;
  constructor(pane: string, target: BoardTarget, api = boardApi, store: DraftStore = draftStore) {
    this.api = api;
    this.store = store;
    this.pane = pane;
    this.target = target;
    this.key = JSON.stringify([pane, target.sessionId]);
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getSnapshot = () => this.state;
  private patch(patch: Partial<BoardView>) {
    if (this.disposed) return;
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }
  async start() {
    let local: LocalDraft | undefined;
    try {
      local = await this.store.read(this.key);
    } catch {
      this.patch({
        storageError:
          "Local storage unavailable. Unsynced work will not survive a reload. Download your drawing before leaving.",
      });
    }
    if (this.disposed) return;
    if (local) {
      // Legacy dirty drafts have no trustworthy base; never guess their delta.
      this.paused = local.paused ?? (local.dirty && !local.baseScene);
      this.patch({
        board: {
          id: local.boardId,
          revision: local.baseRevision,
          scene: local.baseScene ?? local.scene,
          updatedAt: 0,
          lastAuthor: "human",
          snapshots: [],
          access: null,
        },
        scene: local.scene,
        recovery: local.recovery,
        dirty: local.dirty,
        conflict: this.paused,
        error: this.paused
          ? "Autosave paused. Your previous write or draft needs explicit recovery; no automatic retry."
          : "",
        instruction: local.instruction,
        generation: this.state.generation + 1,
      });
    }
    await this.refresh();
    if (this.disposed) return;
    this.initialized = true;
    this.connectEvents();
    this.schedule();
  }
  private connectEvents() {
    if (this.disposed || this.closeEvents) return;
    try {
      this.closeEvents = this.api.events(
        this.pane,
        this.target,
        (event) => this.event(event),
        () => {
          this.patch({
            connected: false,
            error: "Whiteboard disconnected. You can keep drawing; sharing is paused.",
          });
        },
      );
    } catch (error) {
      this.patch({ connected: false, error: message(error) });
    }
  }
  private event(event: BoardEvent) {
    if (this.disposed) return;
    if (event.type === "unavailable") {
      this.patch({ connected: false, error: event.reason });
      this.closeEvents?.();
      this.closeEvents = undefined;
      return;
    }
    if (
      !this.state.connected ||
      !this.state.board ||
      event.revision > this.state.board.revision ||
      (event.snapshots !== undefined && event.snapshots !== this.state.board.snapshots.length) ||
      canonical(event.access) !== canonical(this.state.board.access)
    ) {
      if (this.pendingRead) this.readAgain = true;
      else void this.refresh();
    }
  }
  private accept(board: BoardState) {
    const current = this.state.board;
    if (current && current.id !== board.id)
      throw new Error("Board identity changed. Download your drawing and reopen this session.");
    if (current && board.revision < current.revision) return;
    if (this.paused || this.state.conflict) {
      this.patch({
        connected: true,
        board: current ? { ...current, access: board.access, snapshots: board.snapshots } : board,
      });
      return;
    }
    if (this.interacting) {
      if (!this.remote || board.revision >= this.remote.revision) this.remote = board;
      this.patch({
        connected: true,
        board: current ? { ...current, access: board.access, snapshots: board.snapshots } : board,
      });
      return;
    }
    const scene =
      this.state.dirty && current && this.state.scene
        ? mergeScene(current.scene, this.state.scene, board.scene)
        : board.scene;
    const changed = canonical(scene) !== canonical(this.state.scene);
    this.patch({
      board,
      scene,
      connected: true,
      error: "",
      dirty: canonical(scene) !== canonical(board.scene),
      ...(changed ? { generation: this.state.generation + 1 } : {}),
    });
    this.persist();
  }
  private pause(error: unknown) {
    this.paused = true;
    this.patch({
      conflict: true,
      error: `${message(error)}. Autosave paused; your local drawing is retained.`,
    });
    this.persist();
  }
  async refresh() {
    if (this.pendingRead) return this.pendingRead;
    const run = async () => {
      await this.pendingSave?.catch(() => {});
      if (this.disposed) return;
      try {
        const board = await this.api.open(this.pane, this.target, this.abort.signal);
        if (this.disposed) return;
        try {
          this.accept(board);
        } catch (error) {
          this.pause(error);
        }
        if (this.initialized) this.connectEvents();
        this.schedule();
      } catch (error) {
        this.patch({ connected: false, error: message(error) });
      }
    };
    this.pendingRead = run().finally(() => {
      this.pendingRead = undefined;
      if (this.readAgain && !this.disposed) {
        this.readAgain = false;
        void this.refresh();
      } else this.schedule();
    });
    return this.pendingRead;
  }
  interaction = (active: boolean) => {
    if (this.disposed) return;
    this.interacting = active;
    if (!active && this.remote) {
      const remote = this.remote;
      this.remote = undefined;
      try {
        this.accept(remote);
      } catch (error) {
        this.pause(error);
      }
    }
    this.schedule();
  };
  change(scene: BoardScene) {
    if (this.disposed || !this.state.board) return;
    this.editVersion++;
    this.patch({ scene, dirty: true });
    this.persist();
    this.schedule();
  }
  instruct(instruction: string) {
    this.patch({ instruction });
    this.persist();
  }
  private schedule() {
    clearTimeout(this.timer);
    if (
      !this.initialized ||
      !this.state.dirty ||
      this.state.conflict ||
      this.paused ||
      this.loadingLatest ||
      !this.state.connected ||
      this.interacting ||
      this.pendingSave ||
      this.pendingRead
    )
      return;
    this.timer = setTimeout(() => {
      void this.flush().catch(() => {});
    }, 600);
  }
  private persist() {
    const { board, scene, instruction, dirty, recovery } = this.state;
    if (!board || !scene) return;
    this.queuedDraft = {
      boardId: board.id,
      baseRevision: board.revision,
      baseScene: board.scene,
      scene,
      instruction,
      dirty,
      paused: this.paused || this.state.conflict,
      recovery,
    };
    if (this.persisting) return;
    this.persisting = true;
    const write = async () => {
      while (this.queuedDraft) {
        const draft = this.queuedDraft;
        this.queuedDraft = undefined;
        await this.store.write(this.key, draft);
      }
      this.patch({ storageError: "" });
    };
    this.persistence = write().finally(() => {
      this.persisting = false;
      // Also drain a final coalesced update during disposal/reload, when no
      // future change()/keepLocal() call will restart the writer.
      if (this.queuedDraft) this.persist();
    });
    void this.persistence.catch(() => {
      this.patch({
        storageError:
          "Could not store your local draft. Download your drawing before leaving or reloading.",
      });
    });
  }
  async keepLocal() {
    this.persist();
    // A draft may be queued after the writer drained but before its finally
    // clears persisting. Do not mistake that older promise for durable storage.
    let observed: Promise<void>;
    do {
      observed = this.persistence;
      await observed;
      if (this.queuedDraft && !this.persisting) this.persist();
    } while (observed !== this.persistence || this.persisting || this.queuedDraft);
  }
  async flush(): Promise<void> {
    clearTimeout(this.timer);
    if (this.disposed) throw new Error("Whiteboard target is no longer active");
    if (this.loadingLatest) throw new Error("Recovery is in progress; your drawing is retained");
    if (this.pendingSave) return this.pendingSave;
    if (this.pendingRead) {
      await this.pendingRead;
      return this.flush();
    }
    if (this.state.conflict || this.paused)
      throw new Error(this.state.error || "Load the latest board before saving");
    if (!this.state.dirty) return;
    if (this.interacting) throw new Error("Finish the current drawing gesture before sending");
    if (!this.state.connected)
      throw new Error("Disconnected. Keep a local draft or reconnect before leaving.");
    const run = async () => {
      this.patch({ saving: true });
      let reconciliations = 0;
      try {
        while (this.state.dirty && !this.disposed && !this.interacting && !this.loadingLatest) {
          if (this.state.conflict || !this.state.connected)
            throw new Error("Board unavailable while saving");
          const { board, scene } = this.state;
          if (!board || !scene) throw new Error("Board unavailable");
          this.paused = true;
          await this.keepLocal().catch(() => {});
          if (this.disposed) return;
          let saved: BoardState;
          try {
            saved = await this.api.save(
              this.pane,
              {
                target: this.target,
                boardId: board.id,
                baseRevision: board.revision,
                scene,
              },
              this.abort.signal,
            );
          } catch (error) {
            if (
              !(error instanceof ApiError && error.status === 409 && error.code === "board_stale")
            )
              throw error;
            // This code is emitted only before a write. Never infer safety from
            // a generic HTTP 409, timeout, invalid ACK, or matching-looking scene.
            if (++reconciliations > 3)
              throw new Error("Board keeps changing; review before saving again");
            const latest = await this.api.open(this.pane, this.target, this.abort.signal);
            if (this.disposed) return;
            if (latest.id !== board.id || latest.revision <= board.revision)
              throw new Error("Invalid reconciliation response");
            this.paused = false;
            this.accept(latest);
            continue;
          }
          if (this.disposed) return;
          if (saved.id !== board.id || saved.revision !== board.revision + 1)
            throw new Error("Invalid save acknowledgement");
          // Changes made during this write are a delta against the submitted
          // scene, not against the older server base. Carry them forward once.
          const next = mergeScene(scene, this.state.scene ?? scene, saved.scene);
          this.paused = false;
          this.patch({
            board: saved,
            scene: next,
            dirty: canonical(next) !== canonical(saved.scene),
            error: "",
          });
          this.persist();
        }
      } catch (error) {
        this.pause(error);
        throw error;
      } finally {
        this.patch({ saving: false });
      }
    };
    this.pendingSave = run().finally(() => {
      this.pendingSave = undefined;
      this.schedule();
    });
    return this.pendingSave;
  }
  async loadLatest() {
    if (this.loadingLatest) throw new Error("Recovery is already in progress");
    this.loadingLatest = true;
    clearTimeout(this.timer);
    try {
      await this.pendingSave?.catch(() => {});
      if (this.disposed) return;
      this.paused = true;
      const version = this.editVersion;
      const currentId = this.state.board?.id;
      // Retain a downloadable recovery copy before any explicit replacement.
      this.patch({ recovery: this.state.scene });
      await this.keepLocal();
      const board = await this.api.open(this.pane, this.target, this.abort.signal);
      if (this.disposed) return;
      if (this.editVersion !== version || this.interacting)
        throw new Error(
          "You drew while loading. Your drawing is retained; review before replacing it.",
        );
      if (board.id !== currentId) throw new Error("Board identity changed; local drawing retained");
      this.remote = undefined;
      this.paused = false;
      this.patch({
        board,
        scene: board.scene,
        dirty: false,
        conflict: false,
        connected: true,
        error: "",
        generation: this.state.generation + 1,
      });
      await this.keepLocal();
    } catch (error) {
      this.pause(error);
      throw error;
    } finally {
      this.loadingLatest = false;
    }
  }
  async revoke() {
    const board = this.state.board;
    if (!board || this.disposed) return;
    await this.api.revoke(this.pane, this.target, board.id, this.abort.signal);
    this.patch({ board: { ...this.state.board!, access: null } });
    await this.refresh();
  }
  dispose() {
    if (this.disposed) return;
    this.persist();
    this.disposed = true;
    clearTimeout(this.timer);
    this.abort.abort();
    this.closeEvents?.();
    this.listeners.clear();
  }
}
