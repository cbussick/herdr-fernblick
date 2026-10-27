import { useMemo, type ReactNode } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";
import styles from "./ChatMessageText.module.css";

export function ChatMath({
  value,
  display,
  source,
  annotated,
}: {
  value: string;
  display: boolean;
  source: ReactNode;
  annotated: boolean;
}) {
  const html = useMemo(() => {
    try {
      return katex.renderToString(value, {
        displayMode: display,
        throwOnError: true,
        trust: false,
        maxExpand: 1000,
        maxSize: 20,
        output: "htmlAndMathml",
        strict: "ignore",
      });
    } catch {
      // Malformed/partially streamed TeX remains readable, never breaks chat.
      return null;
    }
  }, [value, display]);
  if (!html) return source;
  return (
    <span className={display ? styles["math-display"] : styles.math}>
      {annotated ? (
        <span className={styles.syntax} aria-hidden="true" data-message-syntax>
          {source}
        </span>
      ) : null}
      <span data-message-control dangerouslySetInnerHTML={{ __html: html }} />
    </span>
  );
}
