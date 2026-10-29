import { useCallback, useEffect, useId, useState } from "react";
import {
  clearReadReceiptHistory,
  getReadReceiptHistory,
  subscribeReadReceiptHistory,
} from "../shared/api/browserReadReceiptLog";
import styles from "./SettingsDialog.module.css";

export function ReadReceiptLogs() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [notice, setNotice] = useState("");
  const outputId = useId();
  const refresh = useCallback(() => {
    const history = getReadReceiptHistory();
    const value = history.records.map((record) => JSON.stringify(record)).join("\n");
    setText(value);
    setNotice(
      !history.available
        ? "Browser log storage is unavailable."
        : !value
          ? "No saved read-status logs."
          : "",
    );
    return { ...history, text: value };
  }, []);
  useEffect(() => {
    if (open)
      return subscribeReadReceiptHistory(() => {
        refresh();
      });
  }, [open, refresh]);
  return (
    <section className={styles.section} aria-labelledby={outputId + "-heading"}>
      <h3 id={outputId + "-heading"}>Read-status logs</h3>
      <p>
        Stored only on this browser: up to 200 recent entries for seven days, without chat content
        or session paths. Nothing is uploaded. Your browser may clear this history.
      </p>
      <div className={styles.actions}>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={outputId}
          onClick={() => {
            refresh();
            setOpen(!open);
          }}
        >
          View logs
        </button>
        <button
          type="button"
          onClick={async () => {
            const history = refresh();
            if (!history.available) {
              setOpen(true);
              return;
            }
            try {
              if (!navigator.clipboard?.writeText) throw new Error("Unavailable");
              await navigator.clipboard.writeText(history.text);
              setNotice("Logs copied.");
            } catch {
              setOpen(true);
              setNotice("Copy failed. Select the text below to copy manually.");
            }
          }}
        >
          Copy logs
        </button>
        <button
          type="button"
          onClick={() => {
            const cleared = clearReadReceiptHistory();
            // Remove the displayed snapshot too, including after a storage failure.
            setText("");
            setNotice(cleared ? "Logs cleared." : "Could not clear browser log storage.");
          }}
        >
          Clear logs
        </button>
      </div>
      {notice && <p role="status">{notice}</p>}
      {open && (
        <textarea
          id={outputId}
          className={styles["log-output"]}
          aria-label="Saved read-status logs"
          readOnly
          rows={8}
          value={text}
          onFocus={(event) => event.currentTarget.select()}
        />
      )}
    </section>
  );
}
