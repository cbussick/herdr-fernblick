import { EventEmitter } from "node:events";
import type { ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { liveEvents } from "./liveEvents.js";
import type { LiveBridge } from "./liveBridge.js";
import type { Agent } from "../../src/shared/api/contracts.js";
import { MAX_FRAME } from "../../packages/pi-live-chat/protocol.js";

it("coalesces updates while a mobile reader is backpressured instead of disconnecting", async () => {
  let notify!: () => void;
  const response = Object.assign(new EventEmitter(), {
    writableLength: 0,
    writeHead: vi.fn(),
    flushHeaders: vi.fn(),
    write: vi.fn((frame: string) => {
      response.writableLength += Buffer.byteLength(frame);
      return false;
    }),
    destroy: vi.fn(() => response.emit("close")),
  });
  const peer = {
    snapshot: {
      identity: { runtime: randomUUID(), sessionId: "s" },
      epoch: randomUUID(),
      seq: 1,
      messages: [{ id: "large", text: "x".repeat(900_000) }],
    },
  };
  const bridge = {
    subscribe: vi.fn((callback: () => void) => {
      notify = callback;
      return vi.fn();
    }),
    current: vi.fn(() => peer),
    resolve: vi.fn(async () => peer),
  };
  liveEvents(
    response as unknown as ServerResponse,
    { pane_id: "w1:p1" } as Agent,
    bridge as unknown as LiveBridge,
  );
  await vi.waitFor(() => expect(response.write).toHaveBeenCalledOnce());
  for (let seq = 2; seq <= 10; seq++) {
    peer.snapshot = { ...peer.snapshot, seq };
    notify();
    await Promise.resolve();
  }
  expect(response.destroy).not.toHaveBeenCalled();
  expect(response.write).toHaveBeenCalledOnce();
  response.writableLength = 0;
  response.emit("drain");
  await vi.waitFor(() => expect(response.write).toHaveBeenCalledTimes(2));
  expect(response.write.mock.calls[1][0]).toContain('"seq":10');
  response.emit("close");
});

it("drops slow SSE readers without a replay queue and unsubscribes on close", async () => {
  const response = Object.assign(new EventEmitter(), {
    writableLength: MAX_FRAME,
    writeHead: vi.fn(),
    flushHeaders: vi.fn(),
    write: vi.fn(),
    destroy: vi.fn(() => {
      response.emit("close");
    }),
  });
  const unsubscribe = vi.fn();
  const peer = { snapshot: { epoch: randomUUID(), seq: 1 } };
  const bridge = {
    subscribe: vi.fn(() => unsubscribe),
    current: vi.fn(() => peer),
    resolve: vi.fn(async () => peer),
  };
  liveEvents(
    response as unknown as ServerResponse,
    { pane_id: "w1:p1" } as Agent,
    bridge as unknown as LiveBridge,
  );
  await vi.waitFor(() => expect(response.destroy).toHaveBeenCalledOnce());
  expect(response.write).not.toHaveBeenCalled();
  expect(unsubscribe).toHaveBeenCalledOnce();
  expect(bridge.subscribe).toHaveBeenCalledWith(expect.any(Function), "w1:p1");
});
