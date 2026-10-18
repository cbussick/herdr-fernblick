import styles from "./SessionSettingsPicker.module.css";

export function GlobalDefaultAction({
  supported,
  enabled,
  saved,
  onSave,
}: {
  supported: boolean;
  enabled: boolean;
  saved: boolean;
  onSave: () => void;
}) {
  return (
    <footer className={styles.defaults}>
      <button
        type="button"
        className={styles["save-default"]}
        disabled={!supported || !enabled}
        onClick={onSave}
      >
        Use current as global default
      </button>
      <p className={styles.notice}>
        {supported
          ? "For new Pi sessions on this machine. Project, per-model and launch overrides still apply. Running sessions stay unchanged."
          : "Run /reload in Pi to enable saving global defaults."}
      </p>
      {saved ? (
        <p className={styles.notice} role="status">
          Saved as global default.
        </p>
      ) : null}
    </footer>
  );
}
