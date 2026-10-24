import { useEffect, useRef, useState, type ReactNode } from "react";
import { AppUpdatesContext as Context, type CheckResult } from "./useAppUpdates";
import { watchForAppUpdates } from "./appUpdates";
import { fetchLatestBuild, runningBuild, sameBuild, type BuildInfo } from "./buildInfo";

export function AppUpdatesProvider({ children }: { children: ReactNode }) {
  const [online, setOnline] = useState(navigator.onLine);
  const [available, setAvailable] = useState(false);
  const [noticeVisible, setNoticeVisible] = useState(false);
  const [applying, setApplying] = useState(false);
  const [checking, setChecking] = useState(false);
  const [latest, setLatest] = useState<BuildInfo | null>(null);
  const [result, setResult] = useState<CheckResult>("idle");
  const [error, setError] = useState("");
  const updater = useRef<ReturnType<typeof watchForAppUpdates> | null>(null);
  const checkLock = useRef(false);
  const applyLock = useRef(false);

  useEffect(() => {
    const connection = () => setOnline(navigator.onLine);
    window.addEventListener("online", connection);
    window.addEventListener("offline", connection);
    if (import.meta.env.PROD && "serviceWorker" in navigator) {
      updater.current = watchForAppUpdates(() => {
        setAvailable(true);
        setNoticeVisible(true);
      });
    }
    return () => {
      window.removeEventListener("online", connection);
      window.removeEventListener("offline", connection);
      updater.current?.dispose();
      updater.current = null;
    };
  }, []);

  async function check() {
    if (checkLock.current || applyLock.current) return;
    checkLock.current = true;
    setChecking(true);
    setError("");
    try {
      if (!navigator.onLine) throw new Error("Reconnect before checking for updates.");
      const next = await fetchLatestBuild();
      setLatest(next);
      const workerReady = await updater.current?.checkNow();
      if (workerReady || !sameBuild(runningBuild, next)) {
        if (updater.current && !workerReady)
          throw new Error("An update was found but is not ready. Try checking again shortly.");
        setAvailable(true);
        setNoticeVisible(true);
        setResult("update-ready");
        return "update-ready" as const;
      } else {
        setResult("up-to-date");
        return "up-to-date" as const;
      }
    } catch (cause) {
      setResult("failed");
      setError(cause instanceof Error ? cause.message : "Could not check for updates.");
      return "failed" as const;
    } finally {
      checkLock.current = false;
      setChecking(false);
    }
  }

  async function apply() {
    if (applyLock.current || checkLock.current) return;
    applyLock.current = true;
    setApplying(true);
    setError("");
    try {
      if (!navigator.onLine) throw new Error("Reconnect before refreshing.");
      if (updater.current) await updater.current.apply();
      else window.location.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Refresh failed. Try again.");
      setApplying(false);
      applyLock.current = false;
    }
  }

  return (
    <Context.Provider
      value={{
        online,
        available,
        noticeVisible,
        applying,
        checking,
        latest,
        result,
        error,
        check,
        apply,
        dismiss: () => setNoticeVisible(false),
      }}
    >
      {children}
    </Context.Provider>
  );
}
