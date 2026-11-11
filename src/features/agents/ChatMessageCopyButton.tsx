import { useEffect, useState } from "react";
import { Check, Copy, CircleAlert } from "lucide-react";
import { copyCodeText } from "./copyCodeText";
import styles from "./Console.module.css";
import a11yStyles from "../../styles/accessibility.module.css";

export function ChatMessageCopyButton({ text }: { text: string }) {
  const [result, setResult] = useState<{ text: string; status: "copied" | "failed" }>();
  const status = result?.text === text ? result.status : undefined;
  const label =
    status === "copied"
      ? "Message copied"
      : status === "failed"
        ? "Retry copy message"
        : "Copy message";
  useEffect(() => {
    if (!result) return;
    const timer = window.setTimeout(() => setResult(undefined), 2500);
    return () => window.clearTimeout(timer);
  }, [result]);
  return (
    <>
      <button
        type="button"
        className={styles["chat-message__copy"]}
        data-message-control
        data-copy-status={status}
        aria-label={label}
        title={label}
        onClick={async () => {
          try {
            await copyCodeText(text);
            setResult({ text, status: "copied" });
          } catch {
            setResult({ text, status: "failed" });
          }
        }}
      >
        {status === "copied" ? <Check /> : status === "failed" ? <CircleAlert /> : <Copy />}
      </button>
      <span className={a11yStyles["sr-only"]} role="status">
        {status === "copied"
          ? "Message copied"
          : status === "failed"
            ? "Copy failed. Select the message to copy manually, or retry."
            : ""}
      </span>
    </>
  );
}
