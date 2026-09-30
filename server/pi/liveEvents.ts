import type { ServerResponse } from "node:http";
import type { Agent } from "../../src/shared/api/contracts.js";
import type { LiveBridge } from "./liveBridge.js";
import { MAX_FRAME } from "../../packages/pi-live-chat/protocol.js";

// One Herdr lookup before subscription; no Herdr requests in the chat data loop.
// Replacements require a fresh process check, but ordinary frames are direct.
export function liveEvents(response: ServerResponse, agent: Agent, bridge: LiveBridge) {
  let closed = false;
  let running = false;
  let dirty = false;
  let bound: Awaited<ReturnType<LiveBridge["resolve"]>> | undefined;
  let last = "";
  const write = (data: unknown, id?: string) => {
    if (closed) return;
    const frame = `${id ? `id: ${id}\n` : ""}data: ${JSON.stringify(data)}\n\n`;
    if (Buffer.byteLength(frame) + response.writableLength > MAX_FRAME) {
      response.destroy();
      return;
    }
    response.write(frame);
  };
  const refresh = async () => {
    dirty = true;
    if (running || closed) return;
    running = true;
    try {
      while (dirty && !closed) {
        dirty = false;
        try {
          const peer = bridge.current(agent);
          if (peer !== bound) bound = await bridge.resolve(agent);
          const snapshot = bound.snapshot;
          const id = `${snapshot.epoch}:${snapshot.seq}`;
          if (id !== last) {
            write(snapshot, id);
            last = id;
          }
        } catch (error) {
          bound = undefined;
          const reason = error instanceof Error ? error.message : "Live chat unavailable";
          if (last !== reason) {
            write({ type: "unavailable", reason });
            last = reason;
          }
        }
      }
    } finally {
      running = false;
    }
  };
  const unsubscribe = bridge.subscribe(() => {
    void refresh();
  }, agent.pane_id);
  response.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  response.flushHeaders();
  const heartbeat = setInterval(() => {
    if (response.writableLength > MAX_FRAME) response.destroy();
    else response.write(": heartbeat\n\n");
  }, 15_000);
  heartbeat.unref();
  response.on("close", () => {
    closed = true;
    clearInterval(heartbeat);
    unsubscribe();
  });
  void refresh();
}
