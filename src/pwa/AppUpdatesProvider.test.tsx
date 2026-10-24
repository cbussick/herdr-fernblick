import { act, useEffect } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AppUpdatesProvider } from "./AppUpdatesProvider";
import { useAppUpdates } from "./useAppUpdates";
import { fetchLatestBuild, runningBuild } from "./buildInfo";
import { watchForAppUpdates } from "./appUpdates";

vi.mock("./buildInfo", () => ({
  runningBuild: { revision: "a".repeat(40), builtAt: "2026-10-24T11:00:00.000Z" },
  sameBuild: (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b),
  fetchLatestBuild: vi.fn(),
}));
vi.mock("./appUpdates", () => ({ watchForAppUpdates: vi.fn() }));
const worker = { checkNow: vi.fn(), apply: vi.fn(), dispose: vi.fn() };
let renderer: ReactTestRenderer;
let current: NonNullable<ReturnType<typeof useAppUpdates>>;
let events: EventTarget & { location: { reload: ReturnType<typeof vi.fn> } };

function Probe() {
  const updates = useAppUpdates();
  useEffect(() => {
    current = updates!;
  }, [updates]);
  return null;
}
beforeEach(async () => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubEnv("PROD", true);
  events = Object.assign(new EventTarget(), { location: { reload: vi.fn() } });
  vi.stubGlobal("window", events);
  vi.stubGlobal("navigator", { onLine: true, serviceWorker: {} });
  vi.mocked(watchForAppUpdates).mockReturnValue(worker);
  worker.checkNow.mockResolvedValue(false);
  worker.apply.mockResolvedValue(undefined);
  vi.mocked(fetchLatestBuild).mockResolvedValue(runningBuild);
  await act(async () => {
    renderer = create(
      <AppUpdatesProvider>
        <Probe />
      </AppUpdatesProvider>,
    );
  });
});
afterEach(async () => {
  await act(async () => renderer.unmount());
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it("only reports up to date after metadata and worker checks both succeed", async () => {
  expect(current.latest).toBeNull();
  await act(async () => current.check());
  expect(current.result).toBe("up-to-date");
  expect(current.latest).toEqual(runningBuild);
  expect(worker.checkNow).toHaveBeenCalledOnce();
  expect(worker.apply).not.toHaveBeenCalled();
  expect(events.location.reload).not.toHaveBeenCalled();
});

it("reopens a dismissed notice when manually checking a waiting update, without applying it", async () => {
  vi.mocked(watchForAppUpdates).mock.calls[0][0]();
  await act(async () => {});
  expect(current.noticeVisible).toBe(true);
  await act(async () => current.dismiss());
  expect(current.noticeVisible).toBe(false);
  expect(current.available).toBe(true);
  worker.checkNow.mockResolvedValue(true);
  await act(async () => current.check());
  expect(current.result).toBe("update-ready");
  expect(current.noticeVisible).toBe(true);
  expect(worker.apply).not.toHaveBeenCalled();
});

it("shows a newer server build without overwriting the running build", async () => {
  const latest = { ...runningBuild, revision: "b".repeat(40) };
  vi.mocked(fetchLatestBuild).mockResolvedValue(latest);
  worker.checkNow.mockResolvedValue(true);
  await act(async () => current.check());
  expect(current.latest).toEqual(latest);
  expect(runningBuild.revision).toBe("a".repeat(40));
  expect(current.result).toBe("update-ready");
});

it("reports an incomplete download instead of falsely claiming the app is current or ready", async () => {
  vi.mocked(fetchLatestBuild).mockResolvedValue({ ...runningBuild, revision: "b".repeat(40) });
  await act(async () => current.check());
  expect(current.result).toBe("failed");
  expect(current.error).toContain("not ready");
  expect(current.available).toBe(false);
});

it("reports server failures and retains the last successful latest build", async () => {
  await act(async () => current.check());
  vi.mocked(fetchLatestBuild).mockRejectedValue(new Error("Tailnet unreachable"));
  await act(async () => current.check());
  expect(current.result).toBe("failed");
  expect(current.error).toBe("Tailnet unreachable");
  expect(current.latest).toEqual(runningBuild);
  expect(current.checking).toBe(false);
});

it("reports worker failures rather than claiming up to date", async () => {
  worker.checkNow.mockRejectedValue(new Error("Storage blocked"));
  await act(async () => current.check());
  expect(current.result).toBe("failed");
  expect(current.error).toBe("Storage blocked");
});

it("rejects offline checks without sending requests", async () => {
  vi.stubGlobal("navigator", { onLine: false, serviceWorker: {} });
  await act(async () => current.check());
  expect(current.result).toBe("failed");
  expect(current.error).toContain("Reconnect");
  expect(fetchLatestBuild).not.toHaveBeenCalled();
});

it("coalesces repeat checks and never applies without a separate user action", async () => {
  let finish!: (value: typeof runningBuild) => void;
  vi.mocked(fetchLatestBuild).mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  let pending!: Promise<void>;
  await act(async () => {
    pending = current.check();
  });
  expect(current.checking).toBe(true);
  await act(async () => current.check());
  expect(fetchLatestBuild).toHaveBeenCalledOnce();
  await act(async () => {
    finish(runningBuild);
    await pending;
  });
  expect(worker.apply).not.toHaveBeenCalled();
});

it("can identify and explicitly refresh a newer build without service-worker support", async () => {
  await act(async () => renderer.unmount());
  vi.stubGlobal("navigator", { onLine: true });
  await act(async () => {
    renderer = create(
      <AppUpdatesProvider>
        <Probe />
      </AppUpdatesProvider>,
    );
  });
  vi.mocked(fetchLatestBuild).mockResolvedValue({ ...runningBuild, revision: "b".repeat(40) });
  await act(async () => current.check());
  expect(current.result).toBe("update-ready");
  expect(events.location.reload).not.toHaveBeenCalled();
  await act(async () => current.apply());
  expect(events.location.reload).toHaveBeenCalledOnce();
});

it("supports explicit refresh and surfaces retryable activation errors", async () => {
  worker.apply.mockRejectedValue(new Error("Activation failed"));
  await act(async () => current.apply());
  expect(current.error).toBe("Activation failed");
  expect(current.applying).toBe(false);
  worker.apply.mockResolvedValue(undefined);
  await act(async () => current.apply());
  expect(worker.apply).toHaveBeenCalledTimes(2);
});
