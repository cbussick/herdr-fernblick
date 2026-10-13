import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { liveEvents } from "./liveEvents.js";
import { LiveChatError, type LiveBridge } from "./liveBridge.js";
import type { Agent } from "../../src/shared/api/contracts.js";

it.each([
  { reason: "Pi live chat extension unavailable", starting: true, type: "connecting" },
  { reason: "Herdr and Pi session identities do not match", starting: false, type: "unavailable" },
  { reason: "Ambiguous Pi processes for this pane", starting: false, type: "unavailable" },
])(
  "classifies post-connection bridge errors safely: $reason",
  async ({ reason, starting, type }) => {
    let notify!: () => void;
    let missing = false;
    const response = Object.assign(new EventEmitter(), {
      writableLength: 0,
      writeHead: vi.fn(),
      flushHeaders: vi.fn(),
      write: vi.fn(() => true),
      destroy: vi.fn(),
    });
    const peer = {
      snapshot: {
        type: "snapshot",
        identity: { runtime: randomUUID(), sessionId: "s" },
        epoch: randomUUID(),
        seq: 1,
        messages: [{ id: "user", role: "user", text: "hello" }],
      },
    };
    const bridge = {
      subscribe: vi.fn((callback: () => void) => {
        notify = callback;
        return vi.fn();
      }),
      current: vi.fn(() => {
        if (missing) throw new LiveChatError(409, reason, starting);
        return peer;
      }),
      resolve: vi.fn(async () => peer),
    };
    try {
      liveEvents(
        response as unknown as import("node:http").ServerResponse,
        { pane_id: "w1:p1" } as Agent,
        bridge as unknown as LiveBridge,
      );
      await vi.waitFor(() => expect(response.write).toHaveBeenCalledOnce());
      missing = true;
      notify();
      await vi.waitFor(() => expect(response.write).toHaveBeenCalledTimes(2));
      const frames = response.write.mock.calls as unknown as [string][];
      expect(frames[1][0]).toContain(`"type":"${type}"`);
      missing = false;
      peer.snapshot = { ...peer.snapshot, epoch: randomUUID(), seq: 1 };
      notify();
      await vi.waitFor(() => expect(response.write).toHaveBeenCalledTimes(3));
      expect(frames[2][0]).toContain('"type":"snapshot"');
    } finally {
      response.emit("close");
    }
  },
);
