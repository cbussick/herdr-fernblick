import { createHash, randomUUID } from "node:crypto";
import {
  MAX_BOARD_BYTES,
  boardIdSchema,
  boardRequestSchema,
  boardStateSchema,
  boardTargetSchema,
  type BoardGrant,
  type BoardRequest,
  type BoardScene,
  type BoardState,
  type BoardTarget,
} from "../../packages/pi-live-chat/boardProtocol.js";
import { BoardDisk } from "./disk.js";
import { BoardError, requireBoard } from "./errors.js";
import { applyOperations, emptyScene, summarize, validatePng, validateScene } from "./scene.js";

export { BoardError } from "./errors.js";
const PENDING_MS = 30_000;
const ACTIVE_MS = 15 * 60_000;
const MAX_SNAPSHOTS = 128;
const MAX_GRANTS = 1024;
const MAX_OPERATIONS = 128;
const MAX_PENDING_IO = 32;
const MAX_STATE_BYTES = MAX_BOARD_BYTES + 64 * 1024;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
type ApplyResult = {
  revision: number;
  operationId: string;
  applied: string[];
  skipped: { id: string; reason: string }[];
};
type GrantRecord = {
  grant: BoardGrant;
  target: BoardTarget;
  state: "pending" | "active";
  expiresAt: number;
  timer: ReturnType<typeof setTimeout>;
  results: Map<string, { fingerprint: string; result: ApplyResult }>;
  // At most the 2,000 live shape IDs; no scene/assets or capability data retained.
  observed: Map<string, { revision: number; fingerprint: string }>;
};
const sameTarget = (a: BoardTarget, b: BoardTarget) =>
  a.runtime === b.runtime && a.epoch === b.epoch && a.sessionId === b.sessionId;
const validRevision = (revision: number) =>
  requireBoard(Number.isSafeInteger(revision) && revision >= 0, 400, "Invalid board revision");
const validId = (id: string) =>
  requireBoard(boardIdSchema.safeParse(id).success, 400, "Invalid board ID");

function elementFingerprint(element: BoardScene["elements"][number]): string {
  // Compare all native fields, not just summaries/version counters. Key order
  // is not a drawing change, including inside bindings and custom data.
  const canonical = JSON.stringify(element, (_key, value: unknown) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return value;
    const object = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(object)
        .sort()
        .map((key) => [key, object[key]]),
    );
  });
  return createHash("sha256").update(canonical).digest("hex");
}

/** One store instance owns a private directory. Scenes are read on demand, never cached. */
export class BoardStore {
  private readonly disk: BoardDisk;
  private readonly queues = new Map<string, Promise<unknown>>();
  private pendingIO = 0;
  private readonly grants = new Map<string, GrantRecord>();
  private readonly listeners = new Map<string, Set<() => void>>();
  private closed = false;

  constructor(directory: string) {
    this.disk = new BoardDisk(directory);
  }

  static idFor(sessionKey: string): string {
    requireBoard(
      typeof sessionKey === "string" &&
        sessionKey.length > 0 &&
        Buffer.byteLength(sessionKey) <= 16 * 1024,
      400,
      "Invalid board session key",
    );
    return createHash("sha256").update(sessionKey).digest("hex");
  }

  private alive(): void {
    requireBoard(!this.closed, 503, "Board store is closed");
  }
  private guard(authorize?: () => void): () => void {
    return () => {
      this.alive();
      authorize?.();
      this.alive();
    };
  }
  private async serial<T>(id: string, work: () => Promise<T>): Promise<T> {
    this.alive();
    validId(id);
    requireBoard(this.pendingIO < MAX_PENDING_IO, 429, "Too many pending board operations");
    this.pendingIO++;
    const previous = this.queues.get(id) ?? Promise.resolve();
    const task = previous
      .catch(() => undefined)
      .then(() => {
        this.alive();
        return work();
      });
    this.queues.set(id, task);
    try {
      return await task;
    } finally {
      this.pendingIO--;
      if (this.queues.get(id) === task) this.queues.delete(id);
    }
  }

  private async load(id: string): Promise<BoardState | null> {
    const bytes = await this.disk.read(`${id}.json`, MAX_STATE_BYTES);
    this.alive();
    if (!bytes) return null;
    try {
      const parsed = boardStateSchema.safeParse(JSON.parse(bytes.toString("utf8")));
      requireBoard(parsed.success, 500, "Invalid stored board");
      const state = parsed.data;
      requireBoard(
        state.id === id &&
          Number.isSafeInteger(state.revision) &&
          state.snapshots.length <= MAX_SNAPSHOTS &&
          new Set(state.snapshots.map((s) => s.id)).size === state.snapshots.length &&
          state.snapshots.every(
            (s) => Number.isSafeInteger(s.revision) && s.revision <= state.revision,
          ),
        500,
        "Invalid stored board metadata",
      );
      state.scene = validateScene(state.scene);
      state.access = null;
      return state;
    } catch {
      throw new BoardError(500, "Stored board is corrupt or unsafe; refusing to overwrite it");
    }
  }
  private async existing(id: string): Promise<BoardState> {
    const state = await this.load(id);
    requireBoard(state, 404, "Board not found");
    return state;
  }
  private async persist(state: BoardState, authorize: () => void): Promise<void> {
    const bytes = Buffer.from(JSON.stringify({ ...state, access: null }));
    requireBoard(bytes.length <= MAX_STATE_BYTES, 413, "Stored board exceeds size limit");
    await this.disk.write(`${state.id}.json`, bytes, authorize);
  }

  private publicState(state: BoardState): BoardState {
    this.expire();
    const records = [...this.grants.values()].filter((g) => g.grant.boardId === state.id);
    // A single public status summarizes possibly several runtimes; no capability
    // token or target identity is ever placed in the browser's board state.
    records.sort(
      (a, b) =>
        Number(b.state === "active") - Number(a.state === "active") ||
        Number(b.grant.mode === "edit") - Number(a.grant.mode === "edit") ||
        b.expiresAt - a.expiresAt,
    );
    const record = records[0];
    return {
      ...state,
      access: record
        ? { mode: record.grant.mode, state: record.state, expiresAt: record.expiresAt }
        : null,
    };
  }
  private notify(id: string): void {
    for (const listener of [...(this.listeners.get(id) ?? [])]) {
      // Notification consumers cannot undo or turn a durable commit into failure.
      try {
        listener();
      } catch {
        /* Consumers own notification error reporting. */
      }
    }
  }

  async open(sessionKey: string): Promise<BoardState> {
    const id = BoardStore.idFor(sessionKey);
    return this.serial(id, async () => {
      const existing = await this.load(id);
      if (existing) return this.publicState(existing);
      const state: BoardState = {
        id,
        revision: 0,
        scene: emptyScene(),
        updatedAt: Date.now(),
        lastAuthor: "human",
        snapshots: [],
        access: null,
      };
      await this.persist(state, this.guard());
      return this.publicState(state);
    });
  }

  async read(boardId: string): Promise<BoardState> {
    return this.serial(boardId, async () => this.publicState(await this.existing(boardId)));
  }

  async save(
    boardId: string,
    baseRevision: number,
    scene: BoardScene,
    authorize?: () => void,
  ): Promise<BoardState> {
    const check = this.guard(authorize);
    check();
    validRevision(baseRevision);
    const detached = validateScene(scene);
    return this.serial(boardId, async () => {
      check();
      const state = await this.existing(boardId);
      check();
      if (state.revision !== baseRevision)
        throw new BoardError(
          409,
          "Board revision conflict; reconcile before saving",
          "board_stale",
        );
      return this.commitScene(state, detached, "human", check);
    });
  }

  private async commitScene(
    state: BoardState,
    scene: BoardScene,
    author: "human" | "agent",
    check: () => void,
  ): Promise<BoardState> {
    requireBoard(state.revision < Number.MAX_SAFE_INTEGER, 409, "Board revision limit reached");
    const next: BoardState = {
      ...state,
      scene,
      revision: state.revision + 1,
      updatedAt: Date.now(),
      lastAuthor: author,
    };
    await this.persist(next, check);
    this.notify(state.id);
    return this.publicState(next);
  }

  async capture(
    boardId: string,
    revision: number,
    png: Buffer,
    authorize?: () => void,
  ): Promise<{ id: string; revision: number; createdAt: number }> {
    const check = this.guard(authorize);
    check();
    validRevision(revision);
    validatePng(png);
    const detached = Buffer.from(png);
    return this.serial(boardId, async () => {
      check();
      const state = await this.existing(boardId);
      check();
      requireBoard(
        state.revision === revision,
        409,
        "Board revision conflict; capture the current board",
      );
      requireBoard(
        state.snapshots.length < MAX_SNAPSHOTS,
        409,
        "Board snapshot limit (128) reached",
      );
      const ref = { id: randomUUID(), revision, createdAt: Date.now() };
      const name = `${boardId}.${ref.id}.snapshot.json`;
      const bytes = Buffer.from(
        JSON.stringify({ ...ref, scene: state.scene, png: detached.toString("base64") }),
      );
      await this.disk.write(name, bytes, check, true);
      try {
        check();
        await this.persist({ ...state, snapshots: [...state.snapshots, ref] }, check);
      } catch (error) {
        // A rename may have succeeded even if its directory fsync failed. Never
        // remove a snapshot that the on-disk manifest might already reference.
        try {
          const manifest = await this.disk.read(`${boardId}.json`, MAX_STATE_BYTES);
          const parsed =
            manifest && boardStateSchema.safeParse(JSON.parse(manifest.toString("utf8")));
          if (parsed && parsed.success && !parsed.data.snapshots.some((s) => s.id === ref.id)) {
            await this.disk.removeSnapshot(name);
          }
        } catch {
          /* Leave an inaccessible orphan rather than risk data loss. */
        }
        throw error;
      }
      this.notify(boardId);
      return ref;
    });
  }

  async readSnapshot(
    boardId: string,
    snapshotId: string,
  ): Promise<{ scene: BoardScene; png: Buffer; revision: number }> {
    requireBoard(uuid.test(snapshotId), 400, "Invalid snapshot ID");
    return this.serial(boardId, async () => {
      const state = await this.existing(boardId);
      const ref = state.snapshots.find((s) => s.id === snapshotId);
      requireBoard(ref, 404, "Snapshot not found on this board");
      const bytes = await this.disk.read(
        `${boardId}.${snapshotId}.snapshot.json`,
        MAX_BOARD_BYTES * 3,
      );
      this.alive();
      requireBoard(bytes, 500, "Snapshot data is missing");
      try {
        const data = JSON.parse(bytes.toString("utf8")) as Record<string, unknown>;
        requireBoard(
          data.id === ref.id &&
            data.revision === ref.revision &&
            data.createdAt === ref.createdAt &&
            typeof data.png === "string",
          500,
          "Invalid snapshot metadata",
        );
        const png = Buffer.from(data.png, "base64");
        requireBoard(png.toString("base64") === data.png, 500, "Invalid snapshot encoding");
        validatePng(png);
        return { scene: validateScene(data.scene), png, revision: ref.revision };
      } catch {
        throw new BoardError(500, "Stored snapshot is corrupt or unsafe");
      }
    });
  }

  grant(boardId: string, target: BoardTarget, mode: "read" | "edit", revision: number): BoardGrant {
    this.alive();
    validId(boardId);
    validRevision(revision);
    const parsed = boardTargetSchema.safeParse(target);
    requireBoard(
      parsed.success && (mode === "read" || mode === "edit"),
      400,
      "Invalid board grant",
    );
    this.expire();
    for (const record of this.grants.values()) {
      if (record.grant.boardId === boardId && record.target.runtime === target.runtime)
        this.revoke(record.grant.grantId);
    }
    requireBoard(this.grants.size < MAX_GRANTS, 429, "Too many board grants");
    const grant: BoardGrant = { boardId, grantId: randomUUID(), mode, revision };
    const record: GrantRecord = {
      grant,
      target: parsed.data,
      state: "pending",
      expiresAt: Date.now() + PENDING_MS,
      timer: this.expirationTimer(grant.grantId, PENDING_MS),
      results: new Map(),
      observed: new Map(),
    };
    this.grants.set(grant.grantId, record);
    this.notify(boardId);
    return { ...grant };
  }

  private expirationTimer(id: string, delay: number): ReturnType<typeof setTimeout> {
    const timer = setTimeout(() => this.revoke(id), delay);
    timer.unref();
    return timer;
  }
  private expire(): void {
    const now = Date.now();
    for (const [id, record] of this.grants) if (record.expiresAt <= now) this.revoke(id);
  }
  private authorized(request: BoardRequest, active: boolean): GrantRecord {
    this.alive();
    this.expire();
    const record = this.grants.get(request.grantId);
    requireBoard(
      record &&
        record.grant.boardId === request.boardId &&
        sameTarget(record.target, request.target),
      403,
      "Board grant is expired, revoked, or does not match this target",
    );
    requireBoard(!active || record.state === "active", 403, "Board grant is not active");
    return record;
  }

  async handle(input: BoardRequest, validate: () => void): Promise<unknown> {
    const checkTarget = this.guard(validate);
    checkTarget();
    let encoded: string;
    try {
      encoded = JSON.stringify(input);
    } catch {
      throw new BoardError(400, "Invalid board request");
    }
    requireBoard(
      typeof encoded === "string" && Buffer.byteLength(encoded) <= 512 * 1024,
      413,
      "Board request is too large",
    );
    const parsed = boardRequestSchema.safeParse(JSON.parse(encoded));
    requireBoard(parsed.success, 400, "Invalid board request");
    const request = parsed.data;
    const record = this.authorized(
      request,
      request.action === "read" || request.action === "apply",
    );
    const check = () => {
      checkTarget();
      requireBoard(
        this.authorized(request, request.action === "read" || request.action === "apply") ===
          record,
        403,
        "Board grant was replaced",
      );
      if (request.action === "apply")
        requireBoard(record.grant.mode === "edit", 403, "Board grant is read-only");
    };
    check();
    if (request.action === "revoke") {
      this.revoke(request.grantId);
      return { revoked: true };
    }
    return this.serial(request.boardId, async () => {
      check();
      if (request.action === "apply") {
        requireBoard(
          request.baseRevision !== undefined && request.operationId && request.operations,
          400,
          "Apply requires baseRevision, operationId, and operations",
        );
        validRevision(request.baseRevision);
        const fingerprint = createHash("sha256")
          .update(JSON.stringify([request.baseRevision, request.operations]))
          .digest("hex");
        const previous = record.results.get(request.operationId);
        if (previous) {
          requireBoard(
            previous.fingerprint === fingerprint,
            409,
            "Operation ID was already used with different content",
          );
          return structuredClone(previous.result);
        }
        // Do not evict IDs and accidentally replay an old operation. A grant
        // that exhausts this bounded retry ledger must be explicitly renewed.
        requireBoard(
          record.results.size < MAX_OPERATIONS,
          409,
          "Grant operation limit reached; request a new grant",
        );
        const state = await this.existing(request.boardId);
        check();
        requireBoard(
          request.baseRevision <= state.revision,
          409,
          "Board revision is in the future; read the board before editing",
        );
        const elements = new Map(state.scene.elements.map((element) => [element.id, element]));
        const touched = new Set<string>();
        const reasons = new Map<string, string>();
        for (const op of request.operations) {
          requireBoard(
            !touched.has(op.id),
            400,
            "A shape may only be targeted once per operation batch",
          );
          touched.add(op.id);
          const target = elements.get(op.id);
          if (op.op === "create")
            requireBoard(!target, 409, "Shape ID already exists (including deleted shapes)");
          else if (!target || target.isDeleted)
            reasons.set(op.id, op.op === "delete" ? "already_deleted" : "target_deleted");
          const dependencies = new Set([
            ...(op.dependsOn ?? []),
            ...(op.op === "create" ? [] : [op.id]),
          ]);
          for (const id of dependencies) {
            if (reasons.has(op.id)) break;
            const element = elements.get(id);
            const observed = record.observed.get(id);
            if (!element || element.isDeleted) reasons.set(op.id, "dependency_deleted");
            else if (observed?.revision !== request.baseRevision)
              reasons.set(op.id, "target_or_dependency_not_read_at_base_revision");
            else if (observed.fingerprint !== elementFingerprint(element))
              reasons.set(op.id, "target_or_dependency_changed; read again and reconsider");
          }
        }
        const blockedGroups = new Set(
          request.operations
            .filter((op) => reasons.has(op.id) && op.groupId)
            .map((op) => op.groupId!),
        );
        for (const op of request.operations) {
          if (op.groupId && blockedGroups.has(op.groupId) && !reasons.has(op.id))
            reasons.set(op.id, "related_group_conflict; read again and reconsider");
        }
        const eligible = request.operations.filter((op) => !reasons.has(op.id));
        // A single durable commit contains all eligible groups. Rejected groups
        // have no writes; invalid/unsupported operations still fail closed.
        const next = eligible.length
          ? await this.commitScene(state, applyOperations(state.scene, eligible), "agent", check)
          : state;
        check();
        const result: ApplyResult = {
          revision: next.revision,
          operationId: request.operationId,
          applied: eligible.map((op) => op.id),
          skipped: request.operations
            .filter((op) => reasons.has(op.id))
            .map((op) => ({ id: op.id, reason: reasons.get(op.id)! })),
        };
        record.results.set(request.operationId, { fingerprint, result });
        return structuredClone(result);
      }
      const state = await this.existing(request.boardId);
      check();
      if (request.action === "activate") {
        if (record.state === "pending") {
          clearTimeout(record.timer);
          record.state = "active";
          record.expiresAt = Date.now() + ACTIVE_MS;
          record.timer = this.expirationTimer(request.grantId, ACTIVE_MS);
          this.notify(request.boardId);
        }
        // Activation retries do not extend the lease or grant edit privileges.
        return {
          revision: state.revision,
          mode: record.grant.mode,
          state: record.state,
          expiresAt: record.expiresAt,
        };
      }
      const summary = summarize(state.scene, state.revision, request.offset, request.limit);
      const live = new Map(
        state.scene.elements
          .filter((element) => !element.isDeleted)
          .map((element) => [element.id, element]),
      );
      // Prune observations of absent/deleted shapes before recording this page.
      // Pagination authorizes comparisons only for elements actually returned.
      for (const id of record.observed.keys()) if (!live.has(id)) record.observed.delete(id);
      for (const element of summary.elements) {
        const id = element.id as string;
        record.observed.set(id, {
          revision: state.revision,
          fingerprint: elementFingerprint(live.get(id)!),
        });
      }
      return summary;
    });
  }

  revoke(grantId: string): void {
    const record = this.grants.get(grantId);
    if (!record) return;
    clearTimeout(record.timer);
    this.grants.delete(grantId);
    record.results.clear();
    record.observed.clear();
    this.notify(record.grant.boardId);
  }
  revokeTarget(target: BoardTarget): void {
    for (const [id, record] of this.grants) if (sameTarget(record.target, target)) this.revoke(id);
  }
  subscribe(boardId: string, listener: () => void): () => void {
    this.alive();
    validId(boardId);
    requireBoard(
      this.listeners.size < 1024 || this.listeners.has(boardId),
      429,
      "Too many board subscriptions",
    );
    const listeners = this.listeners.get(boardId) ?? new Set<() => void>();
    requireBoard(listeners.size < 128, 429, "Too many board listeners");
    listeners.add(listener);
    this.listeners.set(boardId, listeners);
    return () => {
      listeners.delete(listener);
      if (!listeners.size) this.listeners.delete(boardId);
    };
  }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const id of this.grants.keys()) this.revoke(id);
    this.listeners.clear();
  }
}
