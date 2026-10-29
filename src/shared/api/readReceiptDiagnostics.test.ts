import { afterEach, expect, it, vi } from "vitest";
import { createReadReceiptDiagnostics, safeReadReceiptRequestId } from "./readReceiptDiagnostics";

const requestId = "12345678-1234-4234-8234-123456789abc";
const event = {
  boundary: "client",
  operation: "save",
  requestId,
  category: "network",
  durationMs: 12.4,
} as const;
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it("selects safe fields, rejects arbitrary correlation data, and never logs error payloads", () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const log = createReadReceiptDiagnostics();
  log({
    ...event,
    requestId: "/secret/session.jsonl",
    ...{ error: new Error("credential"), body: "chat content" },
  });
  const record = JSON.parse(warn.mock.calls[0][0]);
  expect(record).toEqual({
    event: "read_receipt",
    schemaVersion: 1,
    build: "unknown",
    severity: "warn",
    dropped: 0,
    timestamp: expect.any(String),
    boundary: "client",
    operation: "save",
    category: "network",
    durationMs: 12,
    suppressed: 0,
  });
  expect(safeReadReceiptRequestId(requestId)).toBe(requestId);
  expect(safeReadReceiptRequestId([requestId])).toBeUndefined();
});

it("bounds failures and reports suppressed events in the next window", () => {
  vi.useFakeTimers();
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const log = createReadReceiptDiagnostics();
  for (let i = 0; i < 100; i++) log(event);
  expect(warn).toHaveBeenCalledTimes(30);
  vi.advanceTimersByTime(60_000);
  log(event);
  expect(JSON.parse(warn.mock.lastCall![0]).suppressed).toBe(70);
});

it("reserves failures even after routine messages exhaust their allowance", () => {
  const sink = vi.fn();
  const log = createReadReceiptDiagnostics({ sink });
  for (let i = 0; i < 100; i++) log({ ...event, category: "success" });
  log(event);
  expect(sink).toHaveBeenCalledTimes(31);
  expect(sink.mock.lastCall![0]).toMatchObject({ category: "network", suppressed: 70 });
});

it("reports a failed sink later without logging raw errors", () => {
  const sink = vi.fn().mockImplementationOnce(() => {
    throw new Error("secret");
  });
  const log = createReadReceiptDiagnostics({ sink, build: "private/path" });
  log(event);
  log(event);
  expect(sink.mock.lastCall![0]).toMatchObject({ dropped: 1, build: "unknown" });
});

it("uses info for expected stale completions and cannot break receipt behavior", () => {
  const info = vi.spyOn(console, "info").mockImplementation(() => {
    throw new Error("sink failed");
  });
  expect(() =>
    createReadReceiptDiagnostics()({ ...event, category: "stale", status: 409 }),
  ).not.toThrow();
  expect(info).toHaveBeenCalledOnce();
});
