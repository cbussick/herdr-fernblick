import type { Snapshot } from "../../../packages/pi-live-chat/protocol";
import { terminalTextSpans } from "../../shared/lib/terminalText";
import styles from "./PiSessionStatus.module.css";

export function PiSessionStatus({ status }: { status: Snapshot["status"] }) {
  return (
    <div
      className={styles.status}
      aria-label="Pi session status"
      data-testid="pi-session-status"
      data-mirrored={status.footerLines ? "" : undefined}
    >
      {status.footerLines ? (
        status.footerLines.map((line, index) => (
          <div key={index} data-testid="pi-footer-line">
            {terminalTextSpans(line).map((span, position) => (
              <span key={position} style={span.style}>
                {span.text}
              </span>
            ))}
          </div>
        ))
      ) : (
        <>
          <div>
            {status.model ?? "Unknown model"} · {status.cwd}
          </div>
          <div>
            {status.totalTokens.toLocaleString()} displayed tokens · ${status.cost.toFixed(2)} ·{" "}
            {status.provider}
          </div>
        </>
      )}
    </div>
  );
}
