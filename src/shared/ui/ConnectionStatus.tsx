import styles from "./ConnectionStatus.module.css";
import { PlugIcon, UnplugIcon } from "./Icons";

export function ConnectionStatus({ connected }: { connected: boolean }) {
  const Icon = connected ? PlugIcon : UnplugIcon;
  return (
    <span
      className={styles.status}
      data-testid="connection-status"
      data-connected={connected}
      role="status"
      aria-atomic="true"
    >
      <Icon />
      {connected ? "Connected" : "Disconnected"}
    </span>
  );
}
