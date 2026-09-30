import { act, useEffect } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vitest";
import { useLiveChat } from "./useLiveChat";
import { randomUUID } from "node:crypto";
import type { Snapshot } from "../../../packages/pi-live-chat/protocol";
import { browserFrame } from "../../../packages/pi-live-chat/browserStream";
class Events {
  static instances: Events[] = [];
  onmessage?: (event: { data: string }) => void;
  onerror?: () => void;
  close = vi.fn();
  constructor() {
    Events.instances.push(this);
  }
}
let renderer: ReactTestRenderer;
let latest: ReturnType<typeof useLiveChat>;
function Probe({ session = "s" }: { session?: string }) {
  const state = useLiveChat("w1:p1", true, session);
  useEffect(() => {
    latest = state;
  }, [state]);
  return null;
}
afterEach(async () => {
  await act(async () => renderer.unmount());
  vi.unstubAllGlobals();
  Events.instances = [];
});
it("retains the conversation during a network interruption and recovers from a fresh snapshot", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("EventSource", Events);
  await act(async () => {
    renderer = create(<Probe />);
  });
  const events = Events.instances[0];
  const snapshot: Snapshot = {
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
    messages: [{ id: "user", role: "user", text: "hello" }],
    status: { cwd: "/", totalTokens: 0, cost: 0 },
  };
  await act(async () => events.onmessage!({ data: JSON.stringify(snapshot) }));
  expect(latest.snapshot).toEqual(snapshot);
  await act(async () => events.onerror!());
  expect(latest.snapshot).toEqual(snapshot);
  expect(latest.error).toBeDefined();
  await act(async () => events.onmessage!({ data: JSON.stringify(snapshot) }));
  expect(latest.error).toBeUndefined();
  const next = { ...snapshot, seq: 2, busy: false };
  await act(async () => events.onmessage!({ data: JSON.stringify(browserFrame(snapshot, next)) }));
  expect(latest.snapshot).toEqual(next);
  await act(async () => renderer.update(<Probe session="other" />));
  expect(latest.snapshot).toBeUndefined();
  expect(events.close).toHaveBeenCalledOnce();
});
