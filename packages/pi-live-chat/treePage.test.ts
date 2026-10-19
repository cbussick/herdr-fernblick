import { SessionManager } from "@earendil-works/pi-coding-agent";
import { expect, it } from "vitest";
import { readTreePage } from "./treePage.js";
import { treePageSchema, treePageRequestSchema, MAX_TREE_PAGE_BYTES } from "./treeProtocol.js";

it("opens a bounded window at the current point in a deep conversation", () => {
  const manager = SessionManager.inMemory();
  const ids: string[] = [];
  for (let i = 0; i < 354; i++) {
    ids.push(manager.appendMessage({ role: "user", content: `Prompt ${i}`, timestamp: i }));
    for (let j = 0; j < 4; j++) manager.appendCustomEntry("extension-state", {});
  }
  const page = readTreePage(manager, {});
  expect(page.rows.map((row) => row.id)).toEqual(ids.slice(-50));
  expect(page.total).toBe(354);
  expect(page.offset).toBe(304);
  expect(page.leafId).toBe(ids.at(-1));
  expect(page.nextOffset).toBeNull();
  expect(page.previousOffset).toBe(254);
  expect(page.rows.every((row) => row.isActivePath)).toBe(true);
  expect(JSON.stringify(page).length).toBeLessThan(128 * 1024);
  const all: string[] = [];
  let offset: number | null = 0;
  while (offset !== null) {
    const next = treePageSchema.parse(readTreePage(manager, { offset, revision: page.revision }));
    all.push(...next.rows.map((row) => row.id));
    offset = next.nextOffset;
  }
  expect(all).toEqual(ids);
});

it("browses more than 2,000 deeply chained entries without nesting the response", () => {
  const manager = SessionManager.inMemory();
  for (let i = 0; i < 10_000; i++)
    manager.appendMessage({ role: "user", content: "Long conversation", timestamp: i });
  const page = treePageSchema.parse(readTreePage(manager, {}));
  expect(page.total).toBe(10_000);
  expect(page.rows).toHaveLength(50);
  expect(page.rows[0]).not.toHaveProperty("children");
  expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThan(MAX_TREE_PAGE_BYTES);
});

it("searches beyond previews and unloaded alternate paths without changing the active branch", () => {
  const manager = SessionManager.inMemory();
  const root = manager.appendMessage({ role: "user", content: "Start", timestamp: 1 });
  const hidden = manager.appendMessage({
    role: "user",
    content: "x".repeat(20_000) + " unique needle",
    timestamp: 2,
  });
  manager.branch(root);
  for (let i = 0; i < 100; i++)
    manager.appendMessage({ role: "user", content: `Active ${i}`, timestamp: i + 3 });
  const before = manager.getLeafId();
  const page = readTreePage(manager, { query: "UNIQUE NEEDLE" });
  expect(page.total).toBe(1);
  expect(page.rows[0]).toMatchObject({
    id: hidden,
    isActivePath: false,
    textTruncated: true,
    text: "x".repeat(240),
  });
  expect(manager.getLeafId()).toBe(before);
});

it("exposes true forks through hidden entries and explores another path without navigating Pi", () => {
  const manager = SessionManager.inMemory();
  const root = manager.appendMessage({ role: "user", content: "Start", timestamp: 1 });
  manager.appendCustomEntry("hidden-state", {});
  const left = manager.appendMessage({ role: "user", content: "Left", timestamp: 2 });
  const end = manager.appendMessage({ role: "user", content: "Left end", timestamp: 3 });
  manager.branch(root);
  const right = manager.appendMessage({ role: "user", content: "Right", timestamp: 4 });
  const page = readTreePage(manager, {});
  expect(page.rows.map((row) => row.id)).toEqual([root, right]);
  expect(page.rows[0].childCount).toBe(2);
  expect(page.rows[1].childCount).toBe(0);
  const choices = readTreePage(manager, { branchesOf: root });
  expect(choices.mode).toBe("branches");
  expect(choices.rows.map((row) => row.id)).toEqual([left, right]);
  const alternate = readTreePage(manager, { focusId: left });
  expect(alternate.rows.map((row) => row.id)).toEqual([root, left, end]);
  expect(alternate.focusId).toBe(left);
  expect(manager.getLeafId()).toBe(right);
});

it("keeps separate root paths reachable, including when the current point precedes all messages", () => {
  const manager = SessionManager.inMemory();
  const first = manager.appendMessage({ role: "user", content: "First", timestamp: 1 });
  manager.resetLeaf();
  const second = manager.appendMessage({ role: "user", content: "Second", timestamp: 2 });
  manager.resetLeaf();
  const page = readTreePage(manager, { branchesOf: null });
  expect(page.rows.map((row) => row.id)).toEqual([first, second]);
  expect(page.rootCount).toBe(2);
  expect(page.leafId).toBeNull();
});

it("handles empty and image-only history and searches labels across the session", () => {
  const manager = SessionManager.inMemory();
  manager.appendCustomEntry("hidden", {});
  expect(readTreePage(manager, {}).rows).toEqual([]);
  const image = manager.appendMessage({
    role: "user",
    content: [{ type: "image", mimeType: "image/png", data: "AAAA" }],
    timestamp: 1,
  });
  manager.appendLabelChange(image, "Checkpoint");
  const page = readTreePage(manager, { query: "checkpoint", filter: "labels" });
  expect(page.rows).toEqual([
    expect.objectContaining({ id: image, text: "", label: "Checkpoint" }),
  ]);
  manager.appendLabelChange(image, undefined);
  expect(readTreePage(manager, { filter: "labels" }).rows).toEqual([]);
});

it("rejects stale page offsets instead of silently skipping entries after history changes", () => {
  const manager = SessionManager.inMemory();
  manager.appendMessage({ role: "user", content: "Start", timestamp: 1 });
  const page = readTreePage(manager, {});
  manager.appendCustomEntry("new-state", {});
  expect(() => readTreePage(manager, { offset: 0, revision: page.revision })).toThrow(
    "Refresh paths",
  );
  expect(treePageRequestSchema.safeParse({ offset: 0 }).success).toBe(false);
  expect(treePageRequestSchema.safeParse({ offset: -1, revision: page.revision }).success).toBe(
    false,
  );
  expect(treePageRequestSchema.safeParse({ query: "x".repeat(257) }).success).toBe(false);
});

it("bounds worst-case encoded previews and keeps the current message in its initial window", () => {
  const entries = Array.from({ length: 154 }, (_, index) => ({
    type: "message" as const,
    id: `${index}` + "\u0001".repeat(240),
    parentId: index ? `${index - 1}` + "\u0001".repeat(240) : null,
    timestamp: "2026-01-01T00:00:00Z",
    message: { role: "user" as const, content: "\u0001".repeat(1_000), timestamp: index },
  }));
  const manager = { getEntries: () => entries, getLeafId: () => entries.at(-1)!.id };
  const page = treePageSchema.parse(readTreePage(manager, {}));
  expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(MAX_TREE_PAGE_BYTES);
  expect(page.rows.at(-1)?.id).toBe(manager.getLeafId());
  expect(page.rows.length).toBeLessThan(50);
  const seen = new Set(page.rows.map((row) => row.id));
  let previousOffset = page.previousOffset;
  while (previousOffset !== null) {
    const previous = treePageSchema.parse(
      readTreePage(manager, { offset: previousOffset, revision: page.revision }),
    );
    previous.rows.forEach((row) => seen.add(row.id));
    expect(Buffer.byteLength(JSON.stringify(previous))).toBeLessThanOrEqual(MAX_TREE_PAGE_BYTES);
    previousOffset = previous.previousOffset;
  }
  expect(seen.size).toBe(entries.length);
});

it("rejects cyclic ancestry instead of recursing or hanging", () => {
  const manager = {
    getEntries: () => [
      { type: "custom" as const, id: "a", parentId: "b", timestamp: "", customType: "state" },
      { type: "custom" as const, id: "b", parentId: "a", timestamp: "", customType: "state" },
    ],
    getLeafId: () => null,
  };
  expect(() => readTreePage(manager, {})).toThrow("cyclic ancestry");
});

it.each(["focusId", "branchesOf"])("rejects an unavailable %s without changing context", (key) => {
  const manager = SessionManager.inMemory();
  expect(() => readTreePage(manager, { [key]: "missing" })).toThrow("unavailable");
  expect(manager.getLeafId()).toBeNull();
});
