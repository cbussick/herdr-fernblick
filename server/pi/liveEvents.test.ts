import { EventEmitter } from "node:events";
import type { ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { liveEvents } from "./liveEvents.js";
import type { LiveBridge } from "./liveBridge.js";
import type { Agent } from "../../src/shared/api/contracts.js";
import { MAX_FRAME } from "../../packages/pi-live-chat/protocol.js";

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
