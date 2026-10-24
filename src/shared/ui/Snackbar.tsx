import { useEffect, useState } from "react";
import { CloseIcon } from "./Icons";
import styles from "./Snackbar.module.css";

/** Never takes focus; actionable errors can remain visible until dismissed. */
export function Snackbar({
  message,
  description,
  action,
  duration = 6_000,
  placement = "floating",
  role = "status",
  onDismiss,
}: {
  message: string;
  description?: string;
  action?: { label: string; onClick: () => void; disabled?: boolean };
  duration?: number | null;
  placement?: "floating" | "anchored" | "dialog";
  role?: "status" | "alert";
  onDismiss: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (duration === null || hovered || focused) return;
    const timer = setTimeout(onDismiss, duration);
    return () => clearTimeout(timer);
  }, [duration, hovered, focused, onDismiss]);

  return (
    <div
      className={styles.snackbar}
      data-testid="snackbar"
      data-placement={placement}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}
    >
      <p role={role} aria-live={role === "alert" ? "assertive" : "polite"} aria-atomic="true">
        {message}
        {description && <span className={styles.description}>{description}</span>}
      </p>
      {action && (
        <button
          type="button"
          className={styles.action}
          disabled={action.disabled}
          onClick={action.onClick}
        >
          {action.label}
        </button>
      )}
      <button
        className={styles.dismiss}
        type="button"
        aria-label="Dismiss notification"
        onClick={onDismiss}
      >
        <CloseIcon />
      </button>
    </div>
  );
}
