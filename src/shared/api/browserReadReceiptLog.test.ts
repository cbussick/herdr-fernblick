import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  clearReadReceiptHistory,
  createBrowserReadReceiptDiagnostics,
  getReadReceiptHistory,
} from "./browserReadReceiptLog";

class MemoryStorage {
  readonly data = new Map<string, string>();
  get length() {
    return this.data.size;
  }
  key(index: number) {
    return [...this.data.keys()][index] ?? null;
  }
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.data.set(key, value);
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
}
let storage: MemoryStorage;
let now: number;
beforeEach(() => {
  storage = new MemoryStorage();
  vi.stubGlobal("localStorage", storage);
  now = Date.now();
  vi.spyOn(Date, "now").mockImplementation(() => now);
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function save(category: "success" | "network" = "network") {
  const requestId = randomUUID();
  createBrowserReadReceiptDiagnostics()({
    boundary: "client",
    operation: "save",
    requestId,
    category,
    durationMs: 25,
  });
  return requestId;
}

it("keeps a redacted event after a new page/module instance and never restores cleared snapshots", async () => {
  const id = save();
  vi.resetModules();
  const reopened = await import("./browserReadReceiptLog");
  expect(reopened.getReadReceiptHistory().records[0]).toMatchObject({
    requestId: id,
    category: "network",
    schemaVersion: 1,
  });
  expect(reopened.clearReadReceiptHistory()).toBe(true);
  save(); // original page writes a new event, without restoring the old page snapshot
  expect(reopened.getReadReceiptHistory().records).toHaveLength(1);
  expect(reopened.getReadReceiptHistory().records[0].requestId).not.toBe(id);
});

it("bounds shared-tab records, preserves unrelated storage, and expires seven-day entries", () => {
  storage.setItem("chat-draft", "not a log");
  for (let i = 0; i < 220; i++) {
    save();
    now += 61_000;
  }
  expect(getReadReceiptHistory().records).toHaveLength(200);
  expect(JSON.stringify(getReadReceiptHistory().records).length).toBeLessThan(128 * 1024);
  now += 7 * 24 * 60 * 60 * 1000 + 1;
  expect(getReadReceiptHistory().records).toEqual([]);
  expect(storage.getItem("chat-draft")).toBe("not a log");
  expect(clearReadReceiptHistory()).toBe(true);
  expect(storage.length).toBe(1);
});

it("strips injected fields and removes invalid, oversized, old-version and future records", () => {
  save();
  const key = storage.key(0)!;
  const original = JSON.parse(storage.getItem(key)!);
  storage.setItem(
    key,
    JSON.stringify({ ...original, secret: "credential\nforged", path: "/session.jsonl" }),
  );
  expect(JSON.stringify(getReadReceiptHistory())).not.toMatch(/credential|session.jsonl|forged/);
  for (const invalid of [
    "{bad",
    "x".repeat(129 * 1024),
    JSON.stringify({ ...original, schemaVersion: 100 }),
    JSON.stringify({ ...original, timestamp: new Date(now + 120_000).toISOString() }),
    JSON.stringify({ ...original, category: "secret\nforged" }),
  ]) {
    storage.setItem(key, invalid);
    expect(getReadReceiptHistory().records).toEqual([]);
    expect(storage.getItem(key)).toBeNull();
  }
});

it("handles denied/quota storage without breaking the request or claiming a saved history", () => {
  vi.spyOn(storage, "setItem").mockImplementation(() => {
    throw new Error("quota");
  });
  expect(() => save()).not.toThrow();
  expect(getReadReceiptHistory().records).toEqual([]);
  vi.stubGlobal("localStorage", undefined);
  expect(() => save()).not.toThrow();
  expect(getReadReceiptHistory()).toEqual({ available: false, records: [] });
  expect(clearReadReceiptHistory()).toBe(false);
});
