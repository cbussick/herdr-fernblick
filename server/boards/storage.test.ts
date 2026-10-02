import { chmod, link, mkdtemp, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  BoardElement,
  BoardGrant,
  BoardOperation,
  BoardRequest,
  BoardScene,
  BoardTarget,
} from "../../packages/pi-live-chat/boardProtocol.js";
import { BoardDisk } from "./disk.js";
import { BoardError, BoardStore } from "./storage.js";

const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const blank = (): BoardScene => ({ elements: [], files: {}, background: "#ffffff" });
const rectangle = (id = "rect"): BoardElement => ({
  id,
  type: "rectangle",
  x: 1,
  y: 2,
  width: 30,
  height: 40,
  version: 1,
  versionNonce: 42,
});
const target = (): BoardTarget => ({
  runtime: randomUUID(),
  epoch: randomUUID(),
  sessionId: "session",
});
const create = (id = "new"): BoardOperation => ({
  op: "create",
  id,
  kind: "rectangle",
  x: 10,
  y: 20,
});
let directory: string;
let store: BoardStore;
let boardId: string;
let owner: BoardTarget;
const validate = () => undefined;
function request(
  grant: BoardGrant,
  action: BoardRequest["action"],
  fields: Partial<BoardRequest> = {},
): BoardRequest {
  return {
    type: "board-request",
    id: randomUUID(),
    target: owner,
    grantId: grant.grantId,
    boardId,
    action,
    ...fields,
  };
}
async function active(mode: "read" | "edit" = "edit", observe = true): Promise<BoardGrant> {
  const grant = store.grant(boardId, owner, mode, (await store.read(boardId)).revision);
  await store.handle(request(grant, "activate"), validate);
  if (observe) await store.handle(request(grant, "read"), validate);
  return grant;
}
function apply(
  grant: BoardGrant,
  operations: BoardOperation[] = [create()],
  baseRevision = 0,
  operationId = randomUUID(),
): BoardRequest {
  return request(grant, "apply", { operations, baseRevision, operationId });
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "fb-boards-"));
  store = new BoardStore(directory);
  owner = target();
  boardId = (await store.open("session-key")).id;
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  store.close();
  await rm(directory, { recursive: true, force: true });
});

it("persists scenes and immutable snapshots across restart without persisting capabilities", async () => {
  expect(boardId).toMatch(/^[a-f0-9]{64}$/);
  expect(BoardStore.idFor("session-key")).toBe(boardId);
  expect(BoardStore.idFor("other-key")).not.toBe(boardId);
  expect((await store.read(boardId)).scene).toEqual(blank());
  const scene = { ...blank(), elements: [rectangle()] };
  await store.save(boardId, 0, scene);
  const snapshot = await store.capture(boardId, 1, png);
  const grant = await active();
  const publicState = await store.read(boardId);
  expect(publicState.access).toMatchObject({ mode: "edit", state: "active" });
  expect(JSON.stringify(publicState)).not.toContain(grant.grantId);
  await store.save(boardId, 1, blank());
  store.close();
  store = new BoardStore(directory);
  expect(await store.open("session-key")).toMatchObject({
    revision: 2,
    scene: blank(),
    access: null,
    snapshots: [snapshot],
  });
  expect(await store.readSnapshot(boardId, snapshot.id)).toEqual({ scene, png, revision: 1 });
  await expect(store.handle(request(grant, "read"), validate)).rejects.toMatchObject({
    status: 403,
  });
  const other = await store.open("other");
  await expect(store.readSnapshot(other.id, snapshot.id)).rejects.toMatchObject({ status: 404 });
});

it("serializes same-revision human saves, and never silently overwrites stale work", async () => {
  const result = await Promise.allSettled([
    store.save(boardId, 0, { ...blank(), elements: [rectangle("one")] }),
    store.save(boardId, 0, { ...blank(), elements: [rectangle("two")] }),
  ]);
  expect(result.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(result.find((r) => r.status === "rejected")).toMatchObject({ reason: { status: 409 } });
  expect((await store.read(boardId)).revision).toBe(1);
  await expect(store.capture(boardId, 0, png)).rejects.toMatchObject({ status: 409 });
  await expect(store.save(boardId, 0, blank())).rejects.toMatchObject({ status: 409 });
});

it("validates operation batches atomically and emits native basic shape records", async () => {
  const grant = await active();
  await store.handle(
    apply(grant, [
      create("box"),
      { op: "create", id: "label", kind: "text", x: 5, y: 6, text: "hello\nworld" },
      { op: "create", id: "arrow", kind: "arrow", x: 10, y: 20, endX: -10, endY: 50 },
    ]),
    validate,
  );
  const first = await store.read(boardId);
  expect(first).toMatchObject({ revision: 1, lastAuthor: "agent" });
  expect(first.scene.elements[0]).toMatchObject({
    seed: expect.any(Number),
    version: 1,
    versionNonce: expect.any(Number),
    strokeWidth: 2,
    groupIds: [],
    frameId: null,
  });
  expect(first.scene.elements[1]).toMatchObject({
    type: "text",
    containerId: null,
    originalText: "hello\nworld",
    fontFamily: 1,
    lineHeight: 1.25,
    autoResize: true,
  });
  expect(first.scene.elements[2]).toMatchObject({
    points: [
      [0, 0],
      [-20, 30],
    ],
    width: 20,
    height: 30,
    startBinding: null,
    endBinding: null,
  });
  await store.handle(request(grant, "read"), validate);
  expect(
    await store.handle(
      apply(
        grant,
        [
          { op: "update", id: "box", x: 99, groupId: "related" },
          { op: "delete", id: "missing", groupId: "related" },
        ],
        1,
      ),
      validate,
    ),
  ).toMatchObject({ applied: [], skipped: [{ id: "box" }, { id: "missing" }] });
  expect(await store.read(boardId)).toEqual(first);
  await store.handle(
    apply(
      grant,
      [
        { op: "update", id: "label", text: "new label", fontSize: 30 },
        { op: "delete", id: "box" },
      ],
      1,
    ),
    validate,
  );
  const second = await store.read(boardId);
  expect(second.scene.elements[0]).toMatchObject({ isDeleted: true, version: 2 });
  expect(second.scene.elements[1]).toMatchObject({
    originalText: "new label",
    version: 2,
    fontSize: 30,
  });
  expect(second.scene.elements[1].versionNonce).not.toBe(first.scene.elements[1].versionNonce);
});

it("serializes concurrent additions onto the latest board without losing human work", async () => {
  const grant = await active();
  const results = await Promise.allSettled([
    store.handle(apply(grant, [create("one")]), validate),
    store.handle(apply(grant, [create("two")]), validate),
  ]);
  expect(results.every((r) => r.status === "fulfilled")).toBe(true);
  const before = await store.read(boardId);
  await store.save(boardId, 2, {
    ...before.scene,
    elements: [...before.scene.elements, rectangle("human")],
  });
  await store.handle(apply(grant, [create("stale")], 0), validate);
  expect((await store.read(boardId)).scene.elements.map((e) => e.id)).toEqual([
    "one",
    "two",
    "human",
    "stale",
  ]);
});

it.each(["update", "delete"] as const)(
  "allows stale %s of a read shape when only unrelated content changed",
  async (op) => {
    await store.save(boardId, 0, { ...blank(), elements: [rectangle()] });
    const grant = await active();
    await store.handle(request(grant, "read"), validate);
    const before = await store.read(boardId);
    await store.save(boardId, 1, {
      ...before.scene,
      background: "#123456",
      elements: [...before.scene.elements, rectangle("human")],
    });
    await store.handle(
      apply(
        grant,
        [create("new"), op === "update" ? { op, id: "rect", x: 500 } : { op, id: "rect" }],
        1,
      ),
      validate,
    );
    const after = await store.read(boardId);
    expect(after.revision).toBe(3);
    expect(after.scene.background).toBe("#123456");
    expect(after.scene.elements[1]).toEqual(rectangle("human"));
    expect(after.scene.elements[0]).toMatchObject(
      op === "update" ? { x: 500 } : { isDeleted: true },
    );
  },
);

it.each(["update", "delete"] as const)(
  "skips a related group when its %s target changed, then permits a reconsidered edit after rereading",
  async (op) => {
    await store.save(boardId, 0, { ...blank(), elements: [rectangle()] });
    const grant = await active();
    await store.handle(request(grant, "read"), validate);
    // Do not rely on native version counters: arbitrary JSON changes count too.
    await store.save(boardId, 1, { ...blank(), elements: [{ ...rectangle(), x: 42 }] });
    const before = await store.read(boardId);
    const operations: BoardOperation[] = [
      create("new"),
      op === "update" ? { op, id: "rect", x: 500 } : { op, id: "rect" },
    ];
    const result = await store.handle(
      apply(
        grant,
        operations.map((op) => ({ ...op, groupId: "related" })),
        1,
      ),
      validate,
    );
    expect(result).toMatchObject({ applied: [], skipped: [{ id: "new" }, { id: "rect" }] });
    expect(await store.read(boardId)).toEqual(before);
    await store.handle(request(grant, "read"), validate);
    await store.handle(apply(grant, operations, 2), validate);
    expect((await store.read(boardId)).revision).toBe(3);
  },
);

it("requires an exact grant-local paginated observation for stale updates", async () => {
  await store.save(boardId, 0, { ...blank(), elements: [rectangle("one"), rectangle("two")] });
  const grant = await active("edit", false);
  await store.handle(request(grant, "read", { offset: 0, limit: 1 }), validate);
  const before = await store.read(boardId);
  await store.save(boardId, 1, { ...before.scene, background: "#123456" });
  expect(
    await store.handle(apply(grant, [{ op: "update", id: "two", x: 10 }], 1), validate),
  ).toMatchObject({ applied: [], skipped: [{ id: "two" }] });
  expect(
    await store.handle(apply(grant, [{ op: "update", id: "one", x: 10 }], 0), validate),
  ).toMatchObject({ applied: [], skipped: [{ id: "one" }] });
  await store.handle(apply(grant, [{ op: "update", id: "one", x: 10 }], 1), validate);
  const replacement = await active();
  expect(
    await store.handle(apply(replacement, [{ op: "delete", id: "two" }], 1), validate),
  ).toMatchObject({ applied: [], skipped: [{ id: "two" }] });
});

it.each(["removed", "deleted"])("rejects edits to a previously read %s shape", async (change) => {
  await store.save(boardId, 0, { ...blank(), elements: [rectangle()] });
  const grant = await active();
  await store.handle(request(grant, "read"), validate);
  await store.save(boardId, 1, {
    ...blank(),
    elements: change === "removed" ? [] : [{ ...rectangle(), isDeleted: true }],
  });
  expect(
    await store.handle(apply(grant, [create(), { op: "delete", id: "rect" }], 1), validate),
  ).toMatchObject({ applied: ["new"], skipped: [{ id: "rect", reason: "already_deleted" }] });
  expect((await store.read(boardId)).revision).toBe(3);
});

it("ignores JSON property order but detects changes made by another agent", async () => {
  await store.save(boardId, 0, { ...blank(), elements: [rectangle()] });
  const grant = await active();
  await store.handle(request(grant, "read"), validate);
  const reordered = Object.fromEntries(Object.entries(rectangle()).reverse()) as BoardElement;
  await store.save(boardId, 1, { ...blank(), elements: [reordered] });
  await store.handle(apply(grant, [{ op: "update", id: "rect", x: 10 }], 1), validate);
  expect(
    await store.handle(apply(grant, [{ op: "delete", id: "rect" }], 1), validate),
  ).toMatchObject({
    applied: [],
    skipped: [{ id: "rect", reason: expect.stringContaining("changed") }],
  });
});

it("checks declared dependencies at commit, skips related groups, and preserves independent additions", async () => {
  await store.save(boardId, 0, { ...blank(), elements: [rectangle()] });
  const grant = await active();
  await store.save(boardId, 1, { ...blank(), elements: [{ ...rectangle(), x: 42 }] });
  const req = apply(
    grant,
    [
      { ...create("dependent"), dependsOn: ["rect"], groupId: "related" },
      { ...create("sibling"), groupId: "related" },
      create("independent"),
      { op: "update", id: "rect", x: 50 },
      { op: "delete", id: "gone" },
    ],
    1,
  );
  const result = await store.handle(req, validate);
  expect(result).toMatchObject({
    revision: 3,
    applied: ["independent"],
    skipped: [
      { id: "dependent", reason: expect.stringContaining("changed") },
      { id: "sibling", reason: expect.stringContaining("group") },
      { id: "rect", reason: expect.stringContaining("changed") },
      { id: "gone", reason: "already_deleted" },
    ],
  });
  expect(await store.handle(req, validate)).toEqual(result);
  expect((await store.read(boardId)).scene.elements.map((e) => e.id)).toEqual([
    "rect",
    "independent",
  ]);
});

it("rejects guessing a current revision without reading the target", async () => {
  await store.save(boardId, 0, { ...blank(), elements: [rectangle()] });
  const grant = await active("edit", false);
  expect(
    await store.handle(apply(grant, [{ op: "delete", id: "rect" }], 1), validate),
  ).toMatchObject({
    revision: 1,
    applied: [],
    skipped: [{ id: "rect", reason: expect.stringContaining("not_read") }],
  });
});

it("reports changed dependencies even for additions and does not commit all-skipped batches", async () => {
  await store.save(boardId, 0, { ...blank(), elements: [rectangle()] });
  const grant = await active();
  await store.save(boardId, 1, { ...blank(), elements: [] });
  const req = apply(grant, [{ ...create(), dependsOn: ["rect"] }], 1);
  const result = await store.handle(req, validate);
  expect(result).toMatchObject({
    revision: 2,
    applied: [],
    skipped: [{ id: "new", reason: "dependency_deleted" }],
  });
  expect(await store.handle(req, validate)).toEqual(result);
  expect((await store.read(boardId)).revision).toBe(2);
});

it("rejects a future revision even for additions", async () => {
  const grant = await active();
  await expect(store.handle(apply(grant, [create()], 1), validate)).rejects.toMatchObject({
    status: 409,
  });
  expect((await store.read(boardId)).revision).toBe(0);
});

it("deduplicates exact operation retries and rejects reused operation IDs with different content", async () => {
  const grant = await active();
  const req = apply(grant);
  const first = await store.handle(req, validate);
  expect(await store.handle({ ...req, id: randomUUID() }, validate)).toEqual(first);
  expect((await store.read(boardId)).revision).toBe(1);
  await expect(
    store.handle({ ...req, operations: [create("different")] }, validate),
  ).rejects.toMatchObject({ status: 409 });
  await store.save(boardId, 1, blank());
  expect(await store.handle(req, validate)).toEqual(first);
  expect((await store.read(boardId)).revision).toBe(2);
});

it("keeps recorded partial outcomes detached from callers", async () => {
  const grant = await active();
  const req = apply(grant, [create(), { op: "delete", id: "gone" }]);
  const first = (await store.handle(req, validate)) as {
    applied: string[];
    skipped: { id: string; reason: string }[];
  };
  first.applied.push("fake");
  first.skipped[0].reason = "fake";
  expect(await store.handle(req, validate)).toMatchObject({
    applied: ["new"],
    skipped: [{ id: "gone", reason: "already_deleted" }],
  });
});

it("bounds the idempotency ledger without evicting old operation IDs for replay", async () => {
  const grant = await active();
  const first = apply(grant);
  const result = await store.handle(first, validate);
  for (let revision = 1; revision < 128; revision++) {
    await store.handle(request(grant, "read"), validate);
    await store.handle(
      apply(grant, [{ op: "update", id: "new", x: revision }], revision),
      validate,
    );
  }
  await expect(
    store.handle(apply(grant, [{ op: "update", id: "new", x: 900 }], 128), validate),
  ).rejects.toThrow("operation limit");
  expect(await store.handle(first, validate)).toEqual(result);
  expect((await store.read(boardId)).revision).toBe(128);
}, 15_000);

it("rejects duplicate shape IDs, duplicate batch targets, and reuse of tombstoned IDs", async () => {
  await expect(
    store.save(boardId, 0, { ...blank(), elements: [rectangle(), rectangle()] }),
  ).rejects.toMatchObject({ status: 400 });
  const grant = await active();
  await expect(store.handle(apply(grant, [create(), create()]), validate)).rejects.toMatchObject({
    status: 400,
  });
  await store.handle(apply(grant), validate);
  await store.handle(request(grant, "read"), validate);
  await store.handle(apply(grant, [{ op: "delete", id: "new" }], 1), validate);
  await expect(store.handle(apply(grant, [create()], 2), validate)).rejects.toMatchObject({
    status: 409,
  });
});

describe("capability lifecycle", () => {
  it("requires activation and an exact grant, board, runtime, epoch, and session", async () => {
    const grant = store.grant(boardId, owner, "edit", 0);
    await expect(store.handle(request(grant, "read"), validate)).rejects.toMatchObject({
      status: 403,
    });
    for (const foreign of [
      target(),
      { ...owner, epoch: randomUUID() },
      { ...owner, sessionId: "other" },
    ]) {
      await expect(
        store.handle(request(grant, "activate", { target: foreign }), validate),
      ).rejects.toMatchObject({ status: 403 });
    }
    await expect(
      store.handle(request(grant, "activate", { boardId: BoardStore.idFor("foreign") }), validate),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      store.handle(request(grant, "activate", { grantId: randomUUID() }), validate),
    ).rejects.toMatchObject({ status: 403 });
    await store.handle(request(grant, "activate"), validate);
    expect(await store.handle(request(grant, "read"), validate)).toMatchObject({
      revision: 0,
      total: 0,
    });
  });

  it("read-only grants cannot apply, and replacement revokes a pending or active grant", async () => {
    const grant = await active("read");
    await expect(store.handle(apply(grant), validate)).rejects.toMatchObject({ status: 403 });
    const replacement = store.grant(boardId, { ...owner, epoch: randomUUID() }, "edit", 0);
    await expect(store.handle(request(grant, "read"), validate)).rejects.toMatchObject({
      status: 403,
    });
    store.revoke(replacement.grantId);
    expect((await store.read(boardId)).access).toBeNull();
  });

  it("expires pending grants after 30 seconds and active grants after 15 minutes without renewing on retries", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    const pending = store.grant(boardId, owner, "edit", 0);
    vi.advanceTimersByTime(30_000);
    await expect(store.handle(request(pending, "activate"), validate)).rejects.toMatchObject({
      status: 403,
    });
    const grant = await active();
    const first = await store.handle(request(grant, "activate"), validate);
    vi.advanceTimersByTime(60_000);
    expect(await store.handle(request(grant, "activate"), validate)).toEqual(first);
    vi.advanceTimersByTime(14 * 60_000);
    await expect(store.handle(request(grant, "read"), validate)).rejects.toMatchObject({
      status: 403,
    });
    expect((await store.read(boardId)).access).toBeNull();
  });

  it("validates target identity on all actions, including idempotent retries and revoke", async () => {
    const grant = await active();
    const req = apply(grant);
    await store.handle(req, validate);
    const denied = () => {
      throw new BoardError(403, "stale target");
    };
    for (const operation of [
      request(grant, "activate"),
      request(grant, "read"),
      req,
      request(grant, "revoke"),
    ]) {
      await expect(store.handle(operation, denied)).rejects.toMatchObject({ status: 403 });
    }
  });

  it("revokeTarget removes that exact target's grants across boards without revoking other targets", async () => {
    const grant = await active();
    const second = await store.open("second");
    const secondGrant = store.grant(second.id, owner, "read", 0);
    const otherTarget = target();
    const otherGrant = store.grant(boardId, otherTarget, "read", 0);
    store.revokeTarget(owner);
    await expect(store.handle(request(grant, "read"), validate)).rejects.toMatchObject({
      status: 403,
    });
    await expect(
      store.handle(request(secondGrant, "activate", { boardId: second.id }), validate),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      store.handle(request(otherGrant, "activate", { target: otherTarget }), validate),
    ).resolves.toMatchObject({ state: "active" });
  });
});

it.each(["revoke", "target", "close"] as const)(
  "invalidates in-flight writes at their final commit authorization: %s",
  async (kind) => {
    const grant = await active();
    const original = BoardDisk.prototype.write;
    vi.spyOn(BoardDisk.prototype, "write").mockImplementationOnce(
      async function (this: BoardDisk, name, bytes, check, immutable) {
        let calls = 0;
        return original.call(
          this,
          name,
          bytes,
          () => {
            if (++calls === 2) {
              if (kind === "revoke") store.revoke(grant.grantId);
              else if (kind === "target") store.revokeTarget(owner);
              else store.close();
            }
            check();
          },
          immutable,
        );
      },
    );
    await expect(store.handle(apply(grant), validate)).rejects.toMatchObject({
      status: kind === "close" ? 503 : 403,
    });
    store.close();
    store = new BoardStore(directory);
    expect((await store.read(boardId)).revision).toBe(0);
    expect((await readdir(directory)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  },
);

it("revalidates after asynchronous reads and rejects a stale target before editing", async () => {
  const grant = await active();
  let valid = true;
  const original = BoardDisk.prototype.read;
  vi.spyOn(BoardDisk.prototype, "read").mockImplementationOnce(
    async function (this: BoardDisk, name, max) {
      const bytes = await original.call(this, name, max);
      valid = false;
      return bytes;
    },
  );
  await expect(
    store.handle(apply(grant), () => {
      if (!valid) throw new BoardError(403, "target changed");
    }),
  ).rejects.toMatchObject({ status: 403 });
  expect((await store.read(boardId)).revision).toBe(0);
});

it("revalidates human saves and captures before commit, with no published snapshot on denial", async () => {
  let calls = 0;
  await expect(
    store.save(boardId, 0, blank(), () => {
      if (++calls >= 4) throw new BoardError(403, "revoked");
    }),
  ).rejects.toMatchObject({ status: 403 });
  calls = 0;
  await expect(
    store.capture(boardId, 0, png, () => {
      if (++calls >= 6) throw new BoardError(403, "revoked");
    }),
  ).rejects.toMatchObject({ status: 403 });
  expect(await store.read(boardId)).toMatchObject({ revision: 0, snapshots: [] });
  expect((await readdir(directory)).filter((name) => name.includes("snapshot"))).toEqual([]);
});

it.each([
  { type: "ellipse" },
  {
    type: "freedraw",
    points: [
      [0, 0],
      [1, 1],
    ],
  },
  { type: "frame" },
  { groupIds: ["group"] },
  { frameId: "frame" },
  { boundElements: [{ id: "label", type: "text" }] },
  { containerId: "container" },
  { startBinding: { elementId: "target" } },
  { endBinding: { elementId: "target" } },
  { locked: true },
])(
  "preserves arbitrary human shapes and explicitly rejects unsafe basic edits: %j",
  async (patch) => {
    const human = { ...rectangle(), ...patch } as BoardElement;
    await store.save(boardId, 0, { ...blank(), elements: [human] });
    const grant = await active();
    await expect(
      store.handle(apply(grant, [{ op: "update", id: "rect", x: 500 }], 1), validate),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      store.handle(apply(grant, [{ op: "delete", id: "rect" }], 1), validate),
    ).rejects.toMatchObject({ status: 400 });
    expect((await store.read(boardId)).scene.elements).toEqual([human]);
    await store.handle(apply(grant, [create()], 1), validate);
    expect((await store.read(boardId)).scene.elements[0]).toEqual(human);
  },
);

it("rejects inbound bindings even if the selected shape has incomplete binding metadata", async () => {
  await store.save(boardId, 0, {
    ...blank(),
    elements: [
      rectangle(),
      {
        ...rectangle("arrow"),
        type: "arrow",
        startBinding: { elementId: "rect" },
        points: [
          [0, 0],
          [10, 10],
        ],
      },
    ],
  });
  const grant = await active();
  await expect(
    store.handle(apply(grant, [{ op: "delete", id: "rect" }], 1), validate),
  ).rejects.toMatchObject({ status: 400 });
});

it("returns bounded live summaries without files, custom data, or full freehand paths", async () => {
  const imageData = `data:image/png;base64,${png.toString("base64")}`;
  const scene: BoardScene = {
    ...blank(),
    files: { asset: { id: "asset", dataURL: imageData, mimeType: "image/png", created: 1 } },
    elements: [
      ...Array.from({ length: 110 }, (_, i) => rectangle(`shape${i}`)),
      { ...rectangle("deleted"), isDeleted: true },
      {
        ...rectangle("free"),
        type: "freedraw",
        points: [
          [1, 2],
          [3, 4],
        ],
        customData: { secret: "hidden" },
      },
      {
        ...rectangle("arrow"),
        type: "arrow",
        points: [
          [0, 0],
          [10, 10],
        ],
      },
      { ...rectangle("image"), type: "image", fileId: "asset" },
    ],
  };
  await store.save(boardId, 0, scene);
  const grant = await active("read");
  const first = (await store.handle(request(grant, "read"), validate)) as {
    elements: unknown[];
    nextOffset: number;
  };
  expect(first).toMatchObject({ revision: 1, total: 113, offset: 0, nextOffset: 100 });
  expect(first.elements).toHaveLength(100);
  const second = (await store.handle(request(grant, "read", { offset: 100 }), validate)) as {
    elements: Record<string, unknown>[];
  };
  expect(second).toMatchObject({ nextOffset: null });
  expect(second.elements.find((e) => e.id === "free")).not.toHaveProperty("points");
  expect(second.elements.find((e) => e.id === "arrow")).toHaveProperty("points", [
    [0, 0],
    [10, 10],
  ]);
  expect(JSON.stringify(second)).not.toMatch(/data:image|hidden|fileId/);
  await expect(
    store.handle(request(grant, "read", { limit: 101 }), validate),
  ).rejects.toMatchObject({ status: 400 });
});

it("rejects embeddables, URL injection, malformed raster files, missing assets, and oversized scenes", async () => {
  for (const unsafe of [
    { ...rectangle(), type: "embeddable" },
    { ...rectangle(), link: "javascript:alert(1)" },
    { ...rectangle(), customData: { dataURL: "data:image/svg+xml;base64,PHN2Zy8+" } },
    { ...rectangle(), type: "image", fileId: "missing" },
  ]) {
    await expect(
      store.save(boardId, 0, { ...blank(), elements: [unsafe as BoardElement] }),
    ).rejects.toMatchObject({ status: 400 });
  }
  await expect(
    store.save(boardId, 0, {
      ...blank(),
      files: {
        asset: {
          id: "asset",
          mimeType: "image/png",
          dataURL: "data:image/png;base64,PHN2Zy8+",
          created: 1,
        },
      },
    }),
  ).rejects.toMatchObject({ status: 400 });
  await expect(
    store.save(boardId, 0, {
      ...blank(),
      elements: [{ ...rectangle(), text: "x".repeat(12 * 1024 * 1024) }],
    }),
  ).rejects.toMatchObject({ status: 413 });
  expect((await store.read(boardId)).revision).toBe(0);
});

it("keeps ordinary web links and existing text layout when only moving or recoloring a shape", async () => {
  const human: BoardElement = {
    ...rectangle("text"),
    type: "text",
    text: "wrapped\\ntext",
    originalText: "wrapped text",
    width: 81,
    height: 52,
    fontSize: 21,
    autoResize: false,
    link: "https://example.com/notes",
  };
  await store.save(boardId, 0, { ...blank(), elements: [human] });
  const grant = await active();
  await store.handle(
    apply(grant, [{ op: "update", id: "text", x: 50, color: "#ff0000" }], 1),
    validate,
  );
  expect((await store.read(boardId)).scene.elements[0]).toMatchObject({
    ...human,
    x: 50,
    strokeColor: "#ff0000",
    version: 2,
    versionNonce: expect.any(Number),
  });
});

it("detaches save and capture inputs before any asynchronous work", async () => {
  const scene = { ...blank(), elements: [rectangle()] };
  const saving = store.save(boardId, 0, scene);
  scene.elements[0].x = 999;
  await saving;
  expect((await store.read(boardId)).scene.elements[0].x).toBe(1);
  const bytes = Buffer.from(png);
  const capturing = store.capture(boardId, 1, bytes);
  bytes.fill(0);
  const ref = await capturing;
  expect((await store.readSnapshot(boardId, ref.id)).png).toEqual(png);
  await expect(store.capture(boardId, 1, bytes)).rejects.toMatchObject({ status: 400 });
});

it("enforces the explicit snapshot limit without deleting sent revisions", async () => {
  const state = await store.read(boardId);
  state.snapshots = Array.from({ length: 128 }, () => ({
    id: randomUUID(),
    revision: 0,
    createdAt: 1,
  }));
  await writeFile(join(directory, `${boardId}.json`), JSON.stringify(state), { mode: 0o600 });
  await expect(store.capture(boardId, 0, png)).rejects.toThrow("snapshot limit");
  expect((await store.read(boardId)).snapshots).toEqual(state.snapshots);
});

it("reports unsupported and malformed operations rather than ignoring fields", async () => {
  const grant = await active();
  for (const operations of [
    [{ op: "create", id: "bad", kind: "image", x: 0, y: 0 }],
    [{ ...create(), link: "https://example.com" }],
    [{ ...create(), text: "not bound text" }],
    [{ op: "create", id: "bad", kind: "arrow", x: 0, y: 0 }],
    [{ op: "create", id: "bad", kind: "text", x: 0, y: 0, text: "hi", width: 100 }],
  ]) {
    await expect(
      store.handle(apply(grant, operations as BoardOperation[]), validate),
    ).rejects.toMatchObject({ status: 400 });
  }
  expect((await store.read(boardId)).revision).toBe(0);
});

it("notifies subscriptions for durable saves/captures and grant lifecycle changes", async () => {
  const listener = vi.fn();
  const unsubscribe = store.subscribe(boardId, listener);
  await store.save(boardId, 0, blank());
  await store.capture(boardId, 1, png);
  const grant = store.grant(boardId, owner, "read", 1);
  await store.handle(request(grant, "activate"), validate);
  store.revoke(grant.grantId);
  expect(listener).toHaveBeenCalledTimes(5);
  unsubscribe();
  await store.save(boardId, 1, blank());
  expect(listener).toHaveBeenCalledTimes(5);
});

it("rejects traversal, corrupt data, symlinks, hard links, and unsafe permissions without replacing files", async () => {
  await expect(store.read("../secret")).rejects.toMatchObject({ status: 400 });
  await expect(store.readSnapshot(boardId, "../secret")).rejects.toMatchObject({ status: 400 });
  const path = join(directory, `${boardId}.json`);
  await chmod(path, 0o644);
  await expect(store.read(boardId)).rejects.toThrow("Unsafe");
  await chmod(path, 0o600);
  const linked = join(directory, "linked");
  await link(path, linked);
  await expect(store.read(boardId)).rejects.toThrow("Unsafe");
  await rm(linked);
  await rm(path);
  await writeFile(linked, "sensitive", { mode: 0o600 });
  await symlink(linked, path);
  await expect(store.open("session-key")).rejects.toThrow();
  await rm(path);
  await writeFile(path, "not json", { mode: 0o600 });
  await expect(store.open("session-key")).rejects.toThrow("corrupt");
  await chmod(directory, 0o755);
  await expect(store.read(boardId)).rejects.toThrow("0700");
  await chmod(directory, 0o700);
});
