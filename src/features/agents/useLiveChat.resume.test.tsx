import { act, StrictMode, useEffect } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useLiveChat } from "./useLiveChat";
import type { Snapshot } from "../../../packages/pi-live-chat/protocol";
import { browserFrame } from "../../../packages/pi-live-chat/browserStream";

class Events {
  static instances: Events[] = [];
  onmessage?: (event: { data: string }) => void;
  onerror?: () => void;
  readyState = 1;
  close = vi.fn(() => {
    this.readyState = 2;
  });
  constructor() {
    Events.instances.push(this);
  }
}
const snapshot: Snapshot = {
  type: "snapshot",
  version: 2,
  identity: {
    runtime: "00000000-0000-4000-8000-000000000001",
    pid: 1,
    processStart: "1",
    pane: "w1:p1",
    herdrSocket: "/test.sock",
    sessionId: "s",
    sessionFile: "/s.jsonl",
  },
  epoch: "00000000-0000-4000-8000-000000000002",
  seq: 1,
  busy: true,
  sendPending: false,
  truncated: false,
  messages: [{ id: "user", role: "user", text: "retained conversation" }],
  status: { cwd: "/", totalTokens: 0, cost: 0 },
};
let renderer: ReactTestRenderer | undefined;
let latest: ReturnType<typeof useLiveChat>;
let document: EventTarget & { visibilityState: string };
let window: EventTarget;
function Probe({ enabled = true, session = "s" }: { enabled?: boolean; session?: string }) {
  const state = useLiveChat("w1:p1", enabled, session);
  useEffect(() => {
    latest = state;
  }, [state]);
  return null;
}
async function mount(element = <Probe />) {
  await act(async () => {
    renderer = create(element);
  });
}
async function message(source: Events, value: unknown = snapshot) {
  await act(async () => source.onmessage!({ data: JSON.stringify(value) }));
}
async function visibility(value: string) {
  document.visibilityState = value;
  await act(async () => document.dispatchEvent(new Event("visibilitychange")));
}
async function resume() {
  await visibility("hidden");
  await visibility("visible");
}
async function advance(ms: number) {
  await act(async () => vi.advanceTimersByTimeAsync(ms));
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(Math, "random").mockReturnValue(0);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("EventSource", Events);
  document = Object.assign(new EventTarget(), { visibilityState: "visible" });
  window = new EventTarget();
  vi.stubGlobal("document", document);
  vi.stubGlobal("window", window);
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  Events.instances = [];
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
it("refreshes a silently stalled stream on return so a stale busy state cannot block sending", async () => {
  await mount();
  const old = Events.instances[0];
  await message(old);
  await visibility("hidden");
  expect(latest.snapshot?.busy).toBe(true);
  expect(latest.error).toBeUndefined();
  // Pi becomes idle while the browser's OPEN stream silently stops delivering.
  await visibility("visible");
  expect(old.close).toHaveBeenCalledOnce();
  expect(Events.instances).toHaveLength(2);
  expect(latest.snapshot).toEqual(snapshot);
  expect(latest.error).toBe("Reconnecting to Pi…");
  await message(Events.instances[1], { ...snapshot, seq: 2, busy: false });
  expect(latest.snapshot?.busy).toBe(false);
  expect(latest.error).toBeUndefined();
});
it("recovers when EventSource reports a terminal closed connection", async () => {
  await mount();
  const old = Events.instances[0];
  await message(old);
  old.readyState = 2;
  await act(async () => old.onerror!());
  expect(latest.error).toBe("Reconnecting to Pi…");
  await advance(1000);
  expect(Events.instances).toHaveLength(2);
  await message(Events.instances[1], { ...snapshot, seq: 2, busy: false });
  expect(latest.error).toBeUndefined();
  expect(latest.snapshot?.busy).toBe(false);
});
it("gates an idle snapshot during recovery and accepts an unchanged full snapshot then patches", async () => {
  await mount();
  const idle = { ...snapshot, busy: false };
  await message(Events.instances[0], idle);
  await resume();
  expect(latest.snapshot).toEqual(idle);
  expect(latest.error).toBeDefined();
  await message(Events.instances[1], idle);
  expect(latest.error).toBeUndefined();
  const next = { ...idle, seq: 2, busy: true };
  await message(Events.instances[1], browserFrame(idle, next));
  expect(latest.snapshot).toEqual(next);
});
it("ignores superseded callbacks and coalesces lifecycle bursts until a fresh snapshot", async () => {
  await mount();
  const old = Events.instances[0];
  await message(old);
  await resume();
  await act(async () => {
    window.dispatchEvent(new Event("online"));
    window.dispatchEvent(Object.assign(new Event("pageshow"), { persisted: true }));
    old.onmessage!({ data: JSON.stringify({ ...snapshot, seq: 99, busy: false }) });
    old.onerror!();
  });
  await resume();
  await advance(2000);
  expect(Events.instances).toHaveLength(2);
  expect(latest.snapshot).toEqual(snapshot);
  expect(latest.error).toBeDefined();
  expect(Events.instances[1].close).not.toHaveBeenCalled();
});
it("rate-limits rapid successful recovery cycles and retires the old baseline immediately", async () => {
  await mount();
  await message(Events.instances[0]);
  await resume();
  const current = Events.instances[1];
  await message(current);
  await resume();
  expect(current.close).toHaveBeenCalledOnce();
  await message(current, { ...snapshot, busy: false });
  expect(latest.error).toBeDefined();
  expect(Events.instances).toHaveLength(2);
  await advance(1000);
  expect(Events.instances).toHaveLength(3);
});
it("leaves CONNECTING retries to EventSource", async () => {
  await mount();
  const source = Events.instances[0];
  await message(source);
  source.readyState = 0;
  await act(async () => source.onerror!());
  await advance(5000);
  expect(Events.instances).toHaveLength(1);
  expect(source.close).not.toHaveBeenCalled();
  await message(source);
  expect(latest.error).toBeUndefined();
});
it("backs off terminal retries, ignores repeated retired errors, and resets after a snapshot", async () => {
  await mount();
  await message(Events.instances[0]);
  for (const delay of [1000, 2000, 4000]) {
    const source = Events.instances.at(-1)!;
    source.readyState = 2;
    await act(async () => {
      source.onerror!();
      source.onerror!();
    });
    const count = Events.instances.length;
    await advance(delay - 1);
    expect(Events.instances).toHaveLength(count);
    await advance(1);
    expect(Events.instances).toHaveLength(count + 1);
  }
  const recovered = Events.instances.at(-1)!;
  await message(recovered);
  recovered.readyState = 2;
  await act(async () => recovered.onerror!());
  const count = Events.instances.length;
  await advance(1000);
  expect(Events.instances).toHaveLength(count + 1);
});
it("retries malformed baselines through the same scheduler", async () => {
  await mount();
  const source = Events.instances[0];
  await message(source);
  await message(source, { type: "patch", baseSeq: 900 });
  expect(source.close).toHaveBeenCalledOnce();
  expect(latest.error).toBeDefined();
  await advance(1000);
  await message(Events.instances[1]);
  expect(latest.error).toBeUndefined();
});
it("ignores online events while hidden and refreshes on visibility or persisted pageshow", async () => {
  await mount();
  await message(Events.instances[0]);
  await visibility("hidden");
  await act(async () => window.dispatchEvent(new Event("online")));
  expect(Events.instances).toHaveLength(1);
  await visibility("visible");
  await message(Events.instances[1]);
  await advance(1000);
  await act(async () =>
    window.dispatchEvent(Object.assign(new Event("pageshow"), { persisted: false })),
  );
  expect(Events.instances).toHaveLength(2);
  await act(async () =>
    window.dispatchEvent(Object.assign(new Event("pageshow"), { persisted: true })),
  );
  expect(Events.instances).toHaveLength(3);
});
it("refreshes on network restoration while visible without waiting for an error", async () => {
  await mount();
  await message(Events.instances[0], { ...snapshot, busy: false });
  await act(async () => window.dispatchEvent(new Event("online")));
  expect(Events.instances).toHaveLength(2);
  expect(latest.error).toBeDefined();
  await message(Events.instances[1], { ...snapshot, busy: false });
  expect(latest.error).toBeUndefined();
});

it("checks elapsed deadlines after suspended timers resume", async () => {
  await mount();
  await message(Events.instances[0]);
  await resume();
  await visibility("hidden");
  // Wall time advanced during suspension, without executing the deadline timer.
  vi.setSystemTime(Date.now() + 60_000);
  await visibility("visible");
  expect(latest.error).toContain("taking too long to reconnect");
  await message(Events.instances.at(-1)!);
  expect(latest.error).toBeUndefined();
});

it("caps terminal retry backoff at thirty seconds", async () => {
  await mount();
  for (const delay of [1000, 2000, 4000, 8000, 16000, 30000, 30000]) {
    const source = Events.instances.at(-1)!;
    source.readyState = 2;
    await act(async () => source.onerror!());
    const count = Events.instances.length;
    await advance(delay - 1);
    expect(Events.instances).toHaveLength(count);
    await advance(1);
    expect(Events.instances).toHaveLength(count + 1);
  }
});

it("does not reset startup deadlines on resume and permits late recovery", async () => {
  await mount();
  await advance(20_000);
  await resume();
  await advance(10_000);
  expect(latest.error).toContain("taking too long to connect");
  await message(Events.instances[1]);
  expect(latest.error).toBeUndefined();
});
it("bounds recovery notices without extending the deadline on repeated resume events", async () => {
  await mount();
  await message(Events.instances[0]);
  await resume();
  await advance(20_000);
  await resume();
  await advance(10_000);
  expect(latest.error).toContain("taking too long to reconnect");
  await resume();
  expect(latest.error).toContain("taking too long to reconnect");
  expect(Events.instances).toHaveLength(3);
  await message(Events.instances[2]);
  expect(latest.error).toBeUndefined();
});
it("invalidates unavailable identities immediately without a protocol retry loop", async () => {
  await mount();
  await message(Events.instances[0]);
  await resume();
  await message(Events.instances[1], { type: "unavailable", reason: "Identity mismatch" });
  expect(latest.snapshot).toBeUndefined();
  expect(latest.error).toBe("Identity mismatch");
  await advance(60_000);
  expect(Events.instances).toHaveLength(2);
  expect(latest.error).toBe("Identity mismatch");
});
it("cancels retry timers and listeners on unmount", async () => {
  await mount();
  const source = Events.instances[0];
  await message(source);
  source.readyState = 2;
  await act(async () => source.onerror!());
  await act(async () => renderer!.unmount());
  renderer = undefined;
  await resume();
  await act(async () => window.dispatchEvent(new Event("online")));
  await advance(60_000);
  expect(Events.instances).toHaveLength(1);
  expect(vi.getTimerCount()).toBe(0);
});
it("gates retained history on re-enable and ignores a previous session's callbacks", async () => {
  await mount();
  const first = Events.instances[0];
  await message(first);
  await act(async () => renderer!.update(<Probe enabled={false} />));
  expect(latest.snapshot).toBeUndefined();
  await resume();
  expect(Events.instances).toHaveLength(1);
  await act(async () => renderer!.update(<Probe />));
  expect(latest.snapshot).toEqual(snapshot);
  expect(latest.error).toBeDefined();
  await message(Events.instances[1]);
  expect(latest.error).toBeUndefined();
  await act(async () => renderer!.update(<Probe session="other" />));
  await message(first);
  expect(latest.snapshot).toBeUndefined();
});
it("keeps only one stream after Strict Mode effect replay", async () => {
  await mount(
    <StrictMode>
      <Probe />
    </StrictMode>,
  );
  expect(Events.instances).toHaveLength(2);
  expect(Events.instances[0].close).toHaveBeenCalledOnce();
  expect(Events.instances[1].close).not.toHaveBeenCalled();
  await message(Events.instances[0]);
  expect(latest.snapshot).toBeUndefined();
  await message(Events.instances[1]);
  expect(latest.snapshot).toEqual(snapshot);
});
