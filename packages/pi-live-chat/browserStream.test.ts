import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { browserFrame, readBrowserFrame } from "./browserStream.js";
import type { Snapshot } from "./protocol.js";
export function fixture(): Snapshot {
  return {
    type: "snapshot",
    version: 1,
    identity: {
      runtime: randomUUID(),
      pid: 1,
      processStart: "1",
      pane: "w1:p1",
      herdrSocket: "/test.sock",
      sessionId: "s",
      sessionFile: "/s.jsonl",
    },
    epoch: randomUUID(),
    seq: 1,
    busy: true,
    sendPending: false,
    truncated: false,
    messages: Array.from({ length: 28 }, (_, i) => ({
      id: `m${i}`,
      role: "tool",
      text: "x".repeat(32000),
    })),
    status: { cwd: "/", totalTokens: 0, cost: 0 },
  };
}
it("sends only changed rows instead of resending a 900 KB conversation", () => {
  const before = fixture();
  const after = {
    ...before,
    seq: 2,
    messages: [...before.messages, { id: "stream", role: "assistant" as const, text: "working" }],
  };
  const frame = browserFrame(before, after);
  expect(Buffer.byteLength(JSON.stringify(before))).toBeGreaterThan(890_000);
  expect(Buffer.byteLength(JSON.stringify(frame))).toBeLessThan(2000);
  expect(readBrowserFrame(before, frame)).toEqual(after);
  const next = {
    ...after,
    seq: 3,
    messages: [
      ...before.messages,
      { id: "stream", role: "assistant" as const, text: "working further" },
    ],
  };
  expect(readBrowserFrame(after, browserFrame(after, next))).toEqual(next);
});
it("reconstructs removed/reordered rows and refuses patches without their exact baseline", () => {
  const before = fixture();
  const after = { ...before, seq: 9, messages: before.messages.slice(5).reverse() };
  const frame = browserFrame(before, after);
  expect(readBrowserFrame(before, frame)).toEqual(after);
  expect(() => readBrowserFrame(undefined, frame)).toThrow();
  expect(() => readBrowserFrame({ ...before, seq: 2 }, frame)).toThrow();
  expect(() => readBrowserFrame({ ...before, epoch: randomUUID() }, frame)).toThrow();
});
it("starts fresh after reconnect, navigation, or runtime replacement", () => {
  const before = fixture();
  for (const next of [
    { ...before, epoch: randomUUID(), seq: 0 },
    { ...before, identity: { ...before.identity, runtime: randomUUID() } },
  ]) {
    expect(browserFrame(before, next).type).toBe("snapshot");
    expect(readBrowserFrame(before, browserFrame(before, next))).toEqual(next);
  }
});
