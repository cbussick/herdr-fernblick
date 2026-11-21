import type { CSSProperties } from "react";
import type { Snapshot } from "../../../packages/pi-live-chat/protocol";
import { terminalTextSpans } from "../../shared/lib/terminalText";
import styles from "./PiSessionStatus.module.css";

type TerminalStyle = CSSProperties & {
  "--terminal-foreground": string | undefined;
  "--terminal-background": string | undefined;
};

function terminalStyle(
  foreground: string | undefined,
  background: string | undefined,
): TerminalStyle {
  return { "--terminal-foreground": foreground, "--terminal-background": background };
}

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
                style={terminalStyle(span.style.color, span.style.backgroundColor)}
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
