import { useEffect, useState } from "react";
import { CloseIcon } from "./Icons";
import styles from "./Snackbar.module.css";

/** Transient confirmation; never takes focus away from the action that caused it. */
export function Snackbar({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (hovered || focused) return;
    const timer = setTimeout(onDismiss, 6_000);
    return () => clearTimeout(timer);
  }, [hovered, focused, onDismiss]);

  return (
    <div
      className={styles.snackbar}
      data-testid="snackbar"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}
    >
      <p role="status" aria-live="polite" aria-atomic="true">
        {message}
      </p>
      <button type="button" aria-label="Dismiss notification" onClick={onDismiss}>
        <CloseIcon />
      </button>
    </div>
  );
}
