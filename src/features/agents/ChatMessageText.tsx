import { Fragment } from "react";
import { splitMessageLinks } from "./chatMessageLinks";
import { annotationPromptIntro, type TextHighlight } from "./annotations";
import annotationStyles from "./ChatAnnotations.module.css";

// Only format the labels of generated user feedback. Assistant text stays
// verbatim so DOM selection offsets continue to match the original response.
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
  let offset = 0;
  const parts = [];
  for (const part of splitMessageLinks(text)) {
    const value = typeof part === "string" ? part : part.text;
    parts.push({ part, value, start: offset, end: offset + value.length });
    offset += value.length;
  }
  return (
    <p data-annotation-source={annotationSource}>
      {parts.map(({ part, value, start, end }, index) => {
        const boundaries = [
          ...new Set([
            start,
            end,
            ...highlights
              .flatMap((range) => [range.start, range.end])
              .filter((point) => point > start && point < end),
          ]),
        ].sort((a, b) => a - b);
        const content = boundaries.slice(0, -1).map((point, i) => {
          const segment = value.slice(point - start, boundaries[i + 1] - start);
          return highlights.some((range) => range.start <= point && range.end > point) ? (
            <mark key={point} className={annotationStyles.highlight}>
              {segment}
            </mark>
          ) : (
            <Fragment key={point}>{emphasizeLabels ? annotationLabels(segment) : segment}</Fragment>
          );
        });
        return typeof part === "string" ? (
          <Fragment key={index}>{content}</Fragment>
        ) : (
          <a key={index} href={part.href} target="_blank" rel="noopener noreferrer">
            {content}
          </a>
        );
      })}
    </p>
  );
}
