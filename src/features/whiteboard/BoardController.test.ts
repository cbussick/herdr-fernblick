import { afterEach, expect, it, vi } from "vitest";
import { BoardController } from "./BoardController";
import { boardApi, type BoardEvent } from "./boardApi";
import type { DraftStore, LocalDraft } from "./draftStore";
import { board, deferred, scene, target } from "./testFixtures";
import { ApiError } from "../../shared/api/apiClient";

const owners: BoardController[] = [];
afterEach(() => {
  owners.splice(0).forEach((owner) => owner.dispose());
});
function setup(local?: LocalDraft) {
  let event!: (value: BoardEvent) => void;
  const close = vi.fn();
  const api = {
    ...boardApi,
    open: vi.fn().mockResolvedValue(board()),
    save: vi.fn().mockImplementation(async (_pane, input) => ({
      ...board(input.baseRevision + 1),
      scene: input.scene,
    })),
    revoke: vi.fn().mockResolvedValue({ ok: true }),
    events: vi.fn().mockImplementation((_pane, _target, callback) => {
      event = callback;
      return close;
    }),
  };
  const store: DraftStore = {
    read: vi.fn().mockResolvedValue(local),
    write: vi.fn().mockResolvedValue(undefined),
  };
  const owner = new BoardController("pane", target, api, store);
  owners.push(owner);
  return { owner, api, store, close, emit: (value: BoardEvent) => event(value) };
}
it("serializes saves and retains edits made while a save is pending", async () => {
  const { owner, api } = setup();
  await owner.start();
  const first = deferred<ReturnType<typeof board>>();
  api.save.mockReturnValueOnce(first.promise);
  owner.change(scene(2));
  const saving = owner.flush();
  owner.change(scene(3));
  await vi.waitFor(() => expect(api.save).toHaveBeenCalledTimes(1));
  first.resolve({ ...board(2), scene: scene(2) });
  await saving;
  expect(api.save).toHaveBeenCalledTimes(2);
  expect(api.save.mock.calls[1][1]).toMatchObject({ baseRevision: 2, scene: scene(3) });
  expect(owner.state.scene).toEqual(scene(3));
  expect(owner.state.dirty).toBe(false);
});
it("keeps local competing edits while rebasing a newer remote revision", async () => {
  const { owner, api } = setup();
  await owner.start();
  owner.change(scene(4));
  api.open.mockResolvedValue(board(2));
  await owner.refresh();
  expect(owner.state.conflict).toBe(false);
  expect(owner.state.scene).toEqual(scene(4));
  expect(owner.state.board?.revision).toBe(2);
  await owner.flush();
  expect(api.save.mock.calls[0][1]).toMatchObject({ baseRevision: 2, scene: scene(4) });
});
it("does not mistake the SSE echo of an in-flight save for a conflict", async () => {
  const { owner, api, emit } = setup();
  await owner.start();
  const pending = deferred<ReturnType<typeof board>>();
  api.save.mockReturnValueOnce(pending.promise);
  owner.change(scene(2));
  const saving = owner.flush();
  api.open.mockResolvedValue(board(2));
  emit({ type: "changed", revision: 2, access: null, lastAuthor: "human" });
  pending.resolve(board(2));
  await saving;
  await owner.refresh();
  expect(owner.state.conflict).toBe(false);
});
it("refreshes newly captured snapshots even when the drawing revision and permissions are unchanged", async () => {
  const { owner, api, emit } = setup();
  await owner.start();
  const snapshot = { id: "33333333-3333-4333-8333-333333333333", revision: 1, createdAt: 1 };
  api.open.mockResolvedValue({ ...board(), snapshots: [snapshot] });
  emit({ type: "changed", revision: 1, access: null, lastAuthor: "human", snapshots: 1 });
  await owner.refresh();
  expect(owner.state.board?.snapshots).toEqual([snapshot]);
  expect(owner.state.dirty).toBe(false);
});

it("pauses autosave after uncertain save failure, even if the user keeps drawing", async () => {
  const { owner, api, store } = setup();
  await owner.start();
  api.save.mockRejectedValue(new Error("Connection lost"));
  owner.change(scene(2));
  await expect(owner.flush()).rejects.toThrow("Connection lost");
  owner.change(scene(3));
  await expect(owner.flush()).rejects.toThrow();
  await owner.keepLocal();
  expect(api.save).toHaveBeenCalledOnce();
  expect(store.write).toHaveBeenLastCalledWith(
    expect.any(String),
    expect.objectContaining({ scene: scene(3), dirty: true, baseRevision: 1 }),
  );
});
it("recovers durable unsynced work without overwriting a newer server revision", async () => {
  const { owner, api } = setup({
    boardId: board().id,
    baseRevision: 0,
    scene: scene(9),
    dirty: true,
    instruction: "Keep this",
  });
  await owner.start();
  expect(owner.state.scene).toEqual(scene(9));
  expect(owner.state.instruction).toBe("Keep this");
  expect(owner.state.conflict).toBe(true);
  expect(api.save).not.toHaveBeenCalled();
});
it("reconciles a confirmed stale save with new strokes made during the reconciliation fetch", async () => {
  const { owner, api } = setup();
  await owner.start();
  const human = {
    ...scene().elements[0],
    id: "human",
    type: "freedraw" as const,
    points: [
      [0, 0],
      [10, 10],
    ],
  };
  const agent = { ...scene().elements[0], id: "agent" };
  owner.change({ ...scene(), elements: [...scene().elements, human] });
  api.save.mockRejectedValueOnce(new ApiError(409, "Stale", "board_stale"));
  const reading = deferred<ReturnType<typeof board>>();
  api.open.mockReturnValueOnce(reading.promise);
  const saving = owner.flush();
  await vi.waitFor(() => expect(api.open).toHaveBeenCalledTimes(2));
  const later = { ...human, id: "later" };
  owner.change({ ...scene(), elements: [...scene().elements, human, later] });
  reading.resolve({ ...board(2), scene: { ...scene(), elements: [...scene().elements, agent] } });
  await saving;
  expect(api.save).toHaveBeenCalledTimes(2);
  expect(api.save.mock.calls[1][1].baseRevision).toBe(2);
  expect(owner.state.scene?.elements.map((e) => e.id).sort()).toEqual([
    "agent",
    "box",
    "human",
    "later",
  ]);
  expect(owner.state.dirty).toBe(false);
  expect(owner.state.conflict).toBe(false);
});

it("defers incoming scene application until the human gesture ends", async () => {
  const { owner, api } = setup();
  await owner.start();
  const generation = owner.state.generation;
  owner.interaction(true);
  owner.change(scene(2));
  api.open.mockResolvedValue({
    ...board(2),
    scene: {
      ...scene(),
      elements: [...scene().elements, { ...scene().elements[0], id: "agent" }],
    },
  });
  await owner.refresh();
  expect(owner.state.generation).toBe(generation);
  expect(owner.state.board?.revision).toBe(1);
  owner.change(scene(3));
  owner.interaction(false);
  expect(owner.state.scene?.elements[0]).toEqual(scene(3).elements[0]);
  expect(owner.state.scene?.elements.map((e) => e.id)).toEqual(["box", "agent"]);
  await owner.flush();
  expect(api.save.mock.calls[0][1].baseRevision).toBe(2);
});

it.each([new Error("Timeout"), new ApiError(409, "Another conflict")])(
  "never reconciles or retries an unconfirmed save failure %s",
  async (error) => {
    const { owner, api, store } = setup();
    await owner.start();
    owner.change(scene(2));
    api.save.mockRejectedValueOnce(error);
    await expect(owner.flush()).rejects.toThrow();
    await owner.keepLocal();
    const draft = vi.mocked(store.write).mock.calls.at(-1)![1];
    expect(draft.paused).toBe(true);
    expect(draft.baseScene).toEqual(scene());
    expect(api.save).toHaveBeenCalledOnce();
    const reopened = setup(draft);
    await reopened.owner.start();
    await expect(reopened.owner.flush()).rejects.toThrow();
    expect(reopened.api.save).not.toHaveBeenCalled();
    expect(reopened.owner.state.scene).toEqual(scene(2));
  },
);

it("persists an in-flight save as paused so reload cannot resend it", async () => {
  const { owner, api, store } = setup();
  await owner.start();
  owner.change(scene(2));
  const pending = deferred<ReturnType<typeof board>>();
  api.save.mockReturnValueOnce(pending.promise);
  const saving = owner.flush();
  await vi.waitFor(() => expect(api.save).toHaveBeenCalledOnce());
  const draft = vi.mocked(store.write).mock.calls.at(-1)![1];
  expect(draft.paused).toBe(true);
  const reopened = setup(draft);
  await reopened.owner.start();
  expect(reopened.owner.state.conflict).toBe(true);
  pending.resolve({ ...board(2), scene: scene(2) });
  await saving;
  await owner.keepLocal();
  expect(vi.mocked(store.write).mock.calls.at(-1)![1].paused).toBe(false);
});

it("caps confirmed-stale reconciliation attempts without losing the drawing", async () => {
  const { owner, api } = setup();
  await owner.start();
  owner.change(scene(10));
  api.save.mockRejectedValue(new ApiError(409, "Stale", "board_stale"));
  let revision = 1;
  api.open.mockImplementation(async () => ({ ...board(++revision), scene: scene() }));
  await expect(owner.flush()).rejects.toThrow("keeps changing");
  expect(api.save).toHaveBeenCalledTimes(4);
  expect(owner.state.scene).toEqual(scene(10));
  expect(owner.state.conflict).toBe(true);
});

it("archives replacement drafts and refuses to discard strokes made during Load latest", async () => {
  const { owner, api, store } = setup();
  await owner.start();
  owner.change(scene(2));
  const pending = deferred<ReturnType<typeof board>>();
  api.open.mockReturnValueOnce(pending.promise);
  const loading = owner.loadLatest();
  await vi.waitFor(() => expect(api.open).toHaveBeenCalledTimes(2));
  owner.change(scene(3));
  pending.resolve(board(2));
  await expect(loading).rejects.toThrow("You drew");
  expect(owner.state.scene).toEqual(scene(3));
  api.open.mockResolvedValue(board(2));
  await owner.loadLatest();
  expect(owner.state.recovery).toEqual(scene(3));
  expect(owner.state.scene).toEqual(scene(2));
  expect(vi.mocked(store.write).mock.calls.at(-1)![1].recovery).toEqual(scene(3));
});

it("does not discard a recovery draft if durable storage fails", async () => {
  const { owner, api, store } = setup();
  await owner.start();
  owner.change(scene(2));
  vi.mocked(store.write).mockRejectedValue(new Error("quota"));
  await expect(owner.loadLatest()).rejects.toThrow("quota");
  expect(owner.state.scene).toEqual(scene(2));
  expect(api.open).toHaveBeenCalledOnce();
});

it("flushes the last coalesced draft even when disposed at the writer handoff", async () => {
  const { owner, store } = setup();
  await owner.start();
  const first = deferred<void>();
  vi.mocked(store.write).mockReturnValueOnce(first.promise);
  owner.change(scene(2));
  owner.change(scene(3));
  owner.dispose();
  first.resolve();
  await vi.waitFor(() =>
    expect(vi.mocked(store.write).mock.calls.at(-1)![1].scene).toEqual(scene(3)),
  );
});

it("reports unavailable durable storage and refuses a local-only leave", async () => {
  const { owner, store } = setup();
  vi.mocked(store.read).mockRejectedValue(new Error("blocked"));
  vi.mocked(store.write).mockRejectedValue(new Error("quota"));
  await owner.start();
  owner.change(scene(2));
  await expect(owner.keepLocal()).rejects.toThrow("quota");
  expect(owner.state.storageError).toContain("local draft");
});
it("closes events, aborts stale target requests and ignores late results on unmount", async () => {
  const { owner, api, close } = setup();
  await owner.start();
  const pending = deferred<ReturnType<typeof board>>();
  api.open.mockReturnValueOnce(pending.promise);
  const reading = owner.refresh();
  await Promise.resolve();
  owner.dispose();
  pending.resolve(board(10));
  await reading;
  expect(close).toHaveBeenCalledOnce();
  expect(api.open.mock.calls.at(-1)?.[2].aborted).toBe(true);
  expect(owner.state.board?.revision).toBe(1);
});
