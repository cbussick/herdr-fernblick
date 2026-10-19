import { StarIcon } from "../../shared/ui/Icons";
import styles from "./SessionSettingsPicker.module.css";

export function GlobalDefaultsNotice({
  available,
  error,
  onRetry,
  retryEnabled,
}: {
  available: boolean;
  error?: string;
  onRetry: () => void;
  retryEnabled: boolean;
}) {
  if (available) return null;
  return error ? (
    <div className={styles.notice} role="alert">
      <p>{error}</p>
      <button type="button" disabled={!retryEnabled} onClick={onRetry}>
        Retry defaults
      </button>
    </div>
  ) : (
    <p className={styles.notice}>Run /reload in Pi to enable row defaults.</p>
  );
}

export function GlobalDefaultAction({
  name,
  enabled,
  saved,
  unavailableReason,
  onSave,
}: {
  name: string;
  enabled: boolean;
  saved: boolean;
  unavailableReason?: string;
  onSave: () => void;
}) {
  const label = saved ? `Global default: ${name}` : `Set ${name} as global default`;
  return (
    <button
      type="button"
      className={styles["row-default"]}
      data-testid="global-default"
      data-default={saved}
      aria-label={label}
      title={unavailableReason ?? label}
      aria-disabled={!enabled || saved}
      onClick={() => {
        if (enabled && !saved) onSave();
      }}
    >
      <StarIcon fill={saved ? "currentColor" : "none"} />
      {saved ? <span>Default</span> : null}
    </button>
  );
}
