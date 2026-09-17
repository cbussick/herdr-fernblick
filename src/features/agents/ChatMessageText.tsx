import { Fragment } from "react";
import { splitMessageLinks } from "./chatMessageLinks";

export function ChatMessageText({ text }: { text: string }) {
  return (
    <p>
      {splitMessageLinks(text).map((part, index) =>
        typeof part === "string" ? (
          <Fragment key={index}>{part}</Fragment>
        ) : (
          <a key={index} href={part.href} target="_blank" rel="noopener noreferrer">
            {part.text}
          </a>
        ),
      )}
    </p>
  );
}
