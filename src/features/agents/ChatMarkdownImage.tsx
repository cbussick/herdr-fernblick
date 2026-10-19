import { useState } from "react";
import styles from "./ChatMessageText.module.css";

export function ChatMarkdownImage({
  src,
  alt,
  title,
  linked,
}: {
  src: string;
  alt: string;
  title?: string;
  linked: boolean;
}) {
  const [failedSource, setFailedSource] = useState<string>();
  const content =
    failedSource === src ? (
      <span>Image unavailable — {alt || "Open image"}</span>
    ) : (
      <img
        className={styles.image}
        src={src}
        alt={alt}
        title={title}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => setFailedSource(src)}
      />
    );
  // Image/fallback labels are UI, not characters in the annotation source.
  // A Markdown image may already be wrapped in a link; never nest anchors.
  return linked ? (
    <span data-message-control>{content}</span>
  ) : (
    <a
      href={src}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={alt || "Open image"}
      data-message-control
    >
      {content}
    </a>
  );
}
