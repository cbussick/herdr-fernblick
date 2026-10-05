import { Fragment, useMemo, type ReactNode } from "react";
import { splitMessageLinks } from "./chatMessageLinks";
import { formatMessageText, type MessagePart } from "./chatMessageFormatting";
import { annotationPromptIntro, type TextHighlight } from "./annotations";
import annotationStyles from "./ChatAnnotations.module.css";
import styles from "./ChatMessageText.module.css";

// Generated user feedback keeps quotes verbatim and formats only its labels.
function annotationLabels(value: string) {
  const parts = [];
  let end = 0;
  for (const match of value.matchAll(/^\*\*(Comment [1-9]\d*)\*\*(?= \(response [^\n]*\))/gm)) {
    parts.push(value.slice(end, match.index));
    parts.push(<strong key={match.index}>{match[1]}</strong>);
    end = match.index + match[0].length;
  }
  parts.push(value.slice(end));
  return parts;
}

export function ChatMessageText({
  text,
  annotationSource,
  annotationFeedback = false,
  highlights = [],
}: {
  text: string;
  annotationSource?: string;
  annotationFeedback?: boolean;
  highlights?: TextHighlight[];
}) {
  const emphasizeLabels =
    annotationFeedback && !annotationSource && text.startsWith(`${annotationPromptIntro}\n\n`);
  const parts = useMemo<MessagePart[]>(() => {
    if (!emphasizeLabels) return formatMessageText(text);
    // Generated annotation prompts keep their original quotes literal.
    let offset = 0;
    return splitMessageLinks(text).map((part) => {
      const value = typeof part === "string" ? part : part.text;
      const content = { kind: "text" as const, start: offset, end: offset + value.length };
      offset += value.length;
      return typeof part === "string"
        ? content
        : { ...content, kind: "link", href: part.href, children: [content] };
    });
  }, [text, emphasizeLabels]);

  function highlighted(start: number, end: number) {
    const boundaries = [
      ...new Set([
        start,
        end,
        ...highlights
          .flatMap((range) => [range.start, range.end])
          .filter((point) => point > start && point < end),
      ]),
    ].sort((a, b) => a - b);
    return boundaries.slice(0, -1).map((point, i) => {
      const segment = text.slice(point, boundaries[i + 1]);
      return highlights.some((range) => range.start <= point && range.end > point) ? (
        <mark key={point} className={annotationStyles.highlight}>
          {segment}
        </mark>
      ) : (
        <Fragment key={point}>{emphasizeLabels ? annotationLabels(segment) : segment}</Fragment>
      );
    });
  }

  function render(part: MessagePart, index: number): ReactNode {
    if (part.kind === "syntax") {
      // Range.toString() includes display:none text; native copying does not.
      // Keep raw delimiters/destinations in the DOM only for assistant annotation
      // sources so existing prefix lengths, quote validation and highlights work.
      return annotationSource ? (
        <span key={index} className={styles.syntax} aria-hidden="true" data-message-syntax>
          {text.slice(part.start, part.end)}
        </span>
      ) : null;
    }
    if (part.kind === "text")
      return <Fragment key={index}>{highlighted(part.start, part.end)}</Fragment>;
    const content = part.children.map(render);
    switch (part.kind) {
      case "strong":
        return <strong key={index}>{content}</strong>;
      case "emphasis":
        return <em key={index}>{content}</em>;
      case "code":
        return (
          <code key={index} className={styles.code}>
            {content}
          </code>
        );
      case "link":
        return (
          <a key={index} href={part.href} target="_blank" rel="noopener noreferrer">
            {content}
          </a>
        );
    }
  }

  return <p data-annotation-source={annotationSource}>{parts.map(render)}</p>;
}
