import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { watchForAppUpdates } from "./appUpdates";

let serviceWorker: EventTarget & { register: ReturnType<typeof vi.fn>; controller: object | null };
let registration: EventTarget & {
  waiting: { postMessage: ReturnType<typeof vi.fn> } | null;
  installing: (EventTarget & { state: string }) | null;
  update: ReturnType<typeof vi.fn>;
};
let windowEvents: EventTarget & { location: { reload: ReturnType<typeof vi.fn> } };
let documentEvents: EventTarget & { visibilityState: string };
let onAvailable: ReturnType<typeof vi.fn<() => void>>;
let updater: ReturnType<typeof watchForAppUpdates>;
let navigatorMock: { onLine: boolean; serviceWorker: typeof serviceWorker };

beforeEach(() => {
  vi.useFakeTimers();
  registration = Object.assign(new EventTarget(), {
    waiting: null,
    installing: null,
    update: vi.fn().mockResolvedValue(undefined),
  });
  serviceWorker = Object.assign(new EventTarget(), {
    register: vi.fn().mockResolvedValue(registration),
    controller: {},
  });
  windowEvents = Object.assign(new EventTarget(), { location: { reload: vi.fn() } });
  documentEvents = Object.assign(new EventTarget(), { visibilityState: "visible" });
  navigatorMock = { onLine: true, serviceWorker };
  vi.stubGlobal("window", windowEvents);
  vi.stubGlobal("document", documentEvents);
  vi.stubGlobal("navigator", navigatorMock);
  onAvailable = vi.fn();
});
afterEach(() => {
  updater?.dispose();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function start() {
  updater = watchForAppUpdates(onAvailable);
  await Promise.resolve();
}

it("registers only its own root worker without activating or reloading a waiting update", async () => {
  registration.waiting = { postMessage: vi.fn() };
  await start();
  expect(serviceWorker.register).toHaveBeenCalledWith("/sw.js", {
    scope: "/",
    updateViaCache: "none",
  });
  expect(onAvailable).toHaveBeenCalledOnce();
  expect(registration.waiting.postMessage).not.toHaveBeenCalled();
  expect(windowEvents.location.reload).not.toHaveBeenCalled();
});

it("reloads only after this window explicitly accepts and the worker activates", async () => {
  registration.waiting = { postMessage: vi.fn() };
  await start();
  const applied = updater.apply();
  expect(registration.waiting.postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
  expect(windowEvents.location.reload).not.toHaveBeenCalled();
  serviceWorker.dispatchEvent(new Event("controllerchange"));
  await applied;
  expect(windowEvents.location.reload).toHaveBeenCalledOnce();
});

it("an update activated by another window prompts instead of destroying this window's draft", async () => {
  await start();
  serviceWorker.dispatchEvent(new Event("controllerchange"));
  expect(onAvailable).toHaveBeenCalledOnce();
  expect(windowEvents.location.reload).not.toHaveBeenCalled();
  await updater.apply();
  expect(windowEvents.location.reload).toHaveBeenCalledOnce();
});

it("announces a newly installed update but not the first installation", async () => {
  await start();
  const worker = Object.assign(new EventTarget(), { state: "installing" });
  registration.installing = worker;
  serviceWorker.controller = null;
  registration.dispatchEvent(new Event("updatefound"));
  worker.state = "installed";
  worker.dispatchEvent(new Event("statechange"));
  expect(onAvailable).not.toHaveBeenCalled();
  serviceWorker.controller = {};
  worker.dispatchEvent(new Event("statechange"));
  expect(onAvailable).toHaveBeenCalledOnce();
});

it("checks on foreground/reconnect and polls only while visible and online", async () => {
  await start();
  registration.update.mockClear();
  documentEvents.visibilityState = "hidden";
  await vi.advanceTimersByTimeAsync(60_000);
  expect(registration.update).not.toHaveBeenCalled();
  documentEvents.visibilityState = "visible";
  documentEvents.dispatchEvent(new Event("visibilitychange"));
  windowEvents.dispatchEvent(new Event("online"));
  expect(registration.update).toHaveBeenCalledTimes(2);
  navigatorMock.onLine = false;
  await vi.advanceTimersByTimeAsync(60_000);
  expect(registration.update).toHaveBeenCalledTimes(2);
  await expect(updater.apply()).rejects.toThrow("Reconnect");
});

it("allows retry when activation times out and never unregisters or clears storage", async () => {
  registration.waiting = { postMessage: vi.fn() };
  await start();
  const result = expect(updater.apply()).rejects.toThrow("could not be applied");
  await vi.advanceTimersByTimeAsync(15_000);
  await result;
  serviceWorker.dispatchEvent(new Event("controllerchange"));
  expect(windowEvents.location.reload).not.toHaveBeenCalled();
});

it("does not reload later if requesting activation throws", async () => {
  registration.waiting = {
    postMessage: vi.fn(() => {
      throw new Error("Worker unavailable");
    }),
  };
  await start();
  await expect(updater.apply()).rejects.toThrow("Worker unavailable");
  serviceWorker.dispatchEvent(new Event("controllerchange"));
  expect(windowEvents.location.reload).not.toHaveBeenCalled();
});

it("cleans up listeners and ignores registration completing after unmount", async () => {
  let complete!: (value: typeof registration) => void;
  serviceWorker.register.mockReturnValue(
    new Promise((resolve) => {
      complete = resolve;
    }),
  );
  updater = watchForAppUpdates(onAvailable);
  updater.dispose();
  registration.waiting = { postMessage: vi.fn() };
  complete(registration);
  await Promise.resolve();
  serviceWorker.dispatchEvent(new Event("controllerchange"));
  windowEvents.dispatchEvent(new Event("online"));
  await vi.advanceTimersByTimeAsync(60_000);
  expect(onAvailable).not.toHaveBeenCalled();
  expect(registration.update).not.toHaveBeenCalled();
});

it("manual checks rediscover a waiting worker even after a banner is dismissed", async () => {
  await start();
  onAvailable.mockClear();
  registration.waiting = { postMessage: vi.fn() };
  expect(await updater.checkNow()).toBe(true);
  expect(onAvailable).toHaveBeenCalledOnce();
  expect(registration.waiting.postMessage).not.toHaveBeenCalled();
});

it("manual checks surface worker registration and update failures", async () => {
  serviceWorker.register.mockRejectedValue(new Error("Storage blocked"));
  await start();
  await expect(updater.checkNow()).rejects.toThrow("Storage blocked");
  updater.dispose();
  serviceWorker.register.mockResolvedValue(registration);
  await start();
  registration.update.mockRejectedValue(new Error("Server unavailable"));
  await expect(updater.checkNow()).rejects.toThrow("Server unavailable");
});

it("waits for a downloading worker before declaring the update ready", async () => {
  await start();
  const worker = Object.assign(new EventTarget(), { state: "installing" });
  registration.installing = worker;
  let completed = false;
  const checked = updater.checkNow().then((value) => {
    completed = true;
    return value;
  });
  await Promise.resolve();
  await Promise.resolve();
  expect(completed).toBe(false);
  registration.waiting = { postMessage: vi.fn() };
  worker.state = "installed";
  worker.dispatchEvent(new Event("statechange"));
  expect(await checked).toBe(true);
  expect(windowEvents.location.reload).not.toHaveBeenCalled();
});

it("reports download failure and timeouts instead of returning up to date", async () => {
  await start();
  const worker = Object.assign(new EventTarget(), { state: "installing" });
  registration.installing = worker;
  const failed = expect(updater.checkNow()).rejects.toThrow("could not be downloaded");
  await Promise.resolve();
  await Promise.resolve();
  worker.state = "redundant";
  worker.dispatchEvent(new Event("statechange"));
  await failed;
  worker.state = "installing";
  const timedOut = expect(updater.checkNow()).rejects.toThrow("timed out");
  await vi.advanceTimersByTimeAsync(15_000);
  await timedOut;
});
