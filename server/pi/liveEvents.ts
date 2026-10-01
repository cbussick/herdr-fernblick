import type { ServerResponse } from "node:http";
import type { Agent } from "../../src/shared/api/contracts.js";
import { LiveChatError, type LiveBridge } from "./liveBridge.js";
import { browserFrame } from "../../packages/pi-live-chat/browserStream.js";
import type { Snapshot } from "../../packages/pi-live-chat/protocol.js";
import { MAX_FRAME } from "../../packages/pi-live-chat/protocol.js";

// One Herdr lookup before subscription; no Herdr requests in the chat data loop.
// Replacements require a fresh process check, but ordinary frames are direct.
export function liveEvents(response: ServerResponse, agent: Agent, bridge: LiveBridge) {
  let closed = false;
  let running = false;
  let dirty = false;
  let bound: Awaited<ReturnType<LiveBridge["resolve"]>> | undefined;
  let last = "";
  let initialized = false;
  let previous: Snapshot | undefined;
  let paused = false;
  let pausedAt = 0;
  const write = (data: unknown, id?: string) => {
    if (closed) return;
    const frame = `${id ? `id: ${id}\n` : ""}data: ${JSON.stringify(data)}\n\n`;
    if (Buffer.byteLength(frame) + response.writableLength > MAX_FRAME) {
      response.destroy();
      return;
    }
    if (response.write(frame) === false) {
      paused = true;
      pausedAt = Date.now();
    }
  };
  const refresh = async () => {
    dirty = true;
    if (running || closed || paused) return;
    running = true;
    try {
      while (dirty && !closed && !paused) {
        dirty = false;
        try {
          const peer = bridge.current(agent);
          if (peer !== bound) bound = await bridge.resolve(agent);
          if (closed) return;
          const snapshot = bound.snapshot;
          initialized = true;
          const id = `${snapshot.epoch}:${snapshot.seq}`;
          if (id !== last) {
            write(browserFrame(previous, snapshot), id);
            previous = snapshot;
            last = id;
          }
        } catch (error) {
          bound = undefined;
          previous = undefined;
          const reason = error instanceof Error ? error.message : "Live chat unavailable";
          const type =
            !initialized && error instanceof LiveChatError && error.starting
              ? "connecting"
              : "unavailable";
          const key = `${type}:${reason}`;
          if (last !== key) {
            write({ type, reason });
            last = key;
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
  const onDrain = () => {
    paused = false;
    void refresh();
  };
  response.on("drain", onDrain);
  const heartbeat = setInterval(() => {
    if (response.writableLength > MAX_FRAME || (paused && Date.now() - pausedAt > 60_000))
      response.destroy();
    else if (!paused && response.write(": heartbeat\n\n") === false) {
      paused = true;
      pausedAt = Date.now();
    }
  }, 15_000);
  heartbeat.unref();
  response.on("close", () => {
    closed = true;
    clearInterval(heartbeat);
    response.off("drain", onDrain);
    unsubscribe();
  });
  void refresh();
}
