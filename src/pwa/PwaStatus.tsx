import { createPortal } from "react-dom";
import { useAppUpdates } from "./useAppUpdates";
import styles from "./PwaStatus.module.css";

export function PwaStatus() {
  const updates = useAppUpdates();
  if (!updates || (updates.online && !updates.noticeVisible)) return null;
  // Keep global update actions outside the app root, which whiteboard makes inert.
  return createPortal(
    <aside className={styles.notice} aria-label="App status" data-ui="app-status">
      <p role="status">
        {!updates.online
          ? "You’re offline. Reconnect to use Fernblick."
          : updates.error ||
            "A new Fernblick version is ready. Finish drafts in all open windows before refreshing."}
      </p>
      {updates.available && (
        <div className={styles.actions}>
          <button
            type="button"
            disabled={!updates.online || updates.applying || updates.checking}
            onClick={() => void updates.apply()}
          >
            {updates.applying ? "Refreshing…" : "Refresh app"}
          </button>
          <button type="button" disabled={updates.applying} onClick={updates.dismiss}>
            Later
          </button>
        </div>
      )}
    </aside>,
    document.body,
  );
}
