import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { watchForAppUpdates } from "./appUpdates";
import styles from "./PwaStatus.module.css";

export function PwaStatus() {
  const [available, setAvailable] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState("");
  const updater = useRef<ReturnType<typeof watchForAppUpdates> | null>(null);

  useEffect(() => {
    const connection = () => setOnline(navigator.onLine);
    window.addEventListener("online", connection);
    window.addEventListener("offline", connection);
    if (import.meta.env.PROD && "serviceWorker" in navigator) {
      updater.current = watchForAppUpdates(() => setAvailable(true));
    }
    return () => {
      window.removeEventListener("online", connection);
      window.removeEventListener("offline", connection);
      updater.current?.dispose();
      updater.current = null;
    };
  }, []);

  async function refresh() {
    if (!updater.current || applying) return;
    setApplying(true);
    setError("");
    try {
      await updater.current.apply();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Refresh failed. Try again.");
      setApplying(false);
    }
  }

  if (online && !available) return null;
  // Keep global update actions outside the app root, which whiteboard makes inert.
  return createPortal(
    <aside className={styles.notice} aria-label="App status" data-ui="app-status">
      <p role="status">
        {!online
          ? "You’re offline. Reconnect to use Fernblick."
          : error ||
            "A new Fernblick version is ready. Finish drafts in all open windows before refreshing."}
      </p>
      {available && (
        <div className={styles.actions}>
          <button type="button" disabled={!online || applying} onClick={() => void refresh()}>
            {applying ? "Refreshing…" : "Refresh app"}
          </button>
          <button type="button" disabled={applying} onClick={() => setAvailable(false)}>
            Later
          </button>
        </div>
      )}
    </aside>,
    document.body,
  );
}
