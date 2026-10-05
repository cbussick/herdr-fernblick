import type { CSSProperties } from "react";
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
              <span
                key={position}
                className={styles.segment}
                style={
                  {
                    "--terminal-foreground": span.style.color,
                    "--terminal-background": span.style.backgroundColor,
                  } as CSSProperties
                }
                data-bold={span.style.bold ? "" : undefined}
                data-dim={span.style.dim ? "" : undefined}
                data-italic={span.style.italic ? "" : undefined}
                data-underline={span.style.underline ? "" : undefined}
                data-strike={span.style.strike ? "" : undefined}
              >
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
