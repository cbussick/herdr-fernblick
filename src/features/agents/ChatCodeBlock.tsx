import { useEffect, useState, type ReactNode } from "react";
import styles from "./ChatMessageText.module.css";
import a11yStyles from "../../styles/accessibility.module.css";

import { copyCodeText } from "./copyCodeText";

export function ChatCodeBlock({
  value,
  language,
  children,
}: {
  value: string;
  language?: string;
  children: ReactNode;
}) {
  const [result, setResult] = useState<{ value: string; status: "copied" | "failed" }>();
  const status = result?.value === value ? result.status : undefined;
  useEffect(() => {
    if (!result) return;
    const timer = window.setTimeout(() => setResult(undefined), 2500);
    return () => window.clearTimeout(timer);
  }, [result]);
  return (
    <div className={styles["code-block"]} data-testid="chat-code-block">
      <div className={styles["code-toolbar"]} data-message-control>
        <span>{language || "Code"}</span>
        <button
          type="button"
          aria-label="Copy code"
          onClick={async () => {
            try {
              await copyCodeText(value);
              setResult({ value, status: "copied" });
            } catch {
              setResult({ value, status: "failed" });
            }
          }}
        >
          {status === "copied" ? "Copied" : status === "failed" ? "Retry copy" : "Copy"}
        </button>
        <span
          className={status === "failed" ? styles["copy-status"] : a11yStyles["sr-only"]}
          role="status"
        >
          {status === "copied"
            ? "Code copied"
            : status === "failed"
              ? "Copy failed. Select the code to copy manually, or retry."
              : ""}
        </span>
      </div>
      <pre tabIndex={0} aria-label="Code block">
        <code>{children}</code>
      </pre>
    </div>
  );
}
