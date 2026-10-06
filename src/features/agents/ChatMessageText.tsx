import { Fragment, useMemo, type ReactNode } from "react";
import { splitMessageLinks } from "./chatMessageLinks";
import { ChatCodeBlock } from "./ChatCodeBlock";
import { formatMessageText, type MessagePart } from "./chatMessageFormatting";
import {
  annotationGeneralPromptIntro,
  annotationPromptIntro,
  type TextHighlight,
  type AnnotationEditHandler,
} from "./annotations";
import annotationStyles from "./ChatAnnotations.module.css";
import styles from "./ChatMessageText.module.css";

// Generated user feedback keeps quotes verbatim and formats only its labels.
function annotationLabels(value: string) {
  const parts = [];
  let end = 0;
  for (const match of value.matchAll(
    /^\*\*(Comment [1-9]\d*)\*\*(?= \((?:response [^\n]*|general comment)\))/gm,
  )) {
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
  onAnnotationEdit,
}: {
  text: string;
  annotationSource?: string;
  annotationFeedback?: boolean;
  highlights?: TextHighlight[];
  onAnnotationEdit?: AnnotationEditHandler;
}) {
  const emphasizeLabels =
    annotationFeedback &&
    !annotationSource &&
    [annotationPromptIntro, annotationGeneralPromptIntro].some((intro) =>
      text.startsWith(`${intro}\n\n`),
    );
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
      // On overlapping passages, the latest pending comment wins the shared
      // segment; the full pending list still exposes every comment.
      const highlight = highlights.findLast((range) => range.start <= point && range.end > point);
      if (!highlight)
        return (
          <Fragment key={point}>{emphasizeLabels ? annotationLabels(segment) : segment}</Fragment>
        );
      const id = highlight.id;
      const editable = Boolean(id && onAnnotationEdit);
      return (
        <mark
          key={point}
          className={annotationStyles.highlight}
          data-annotation-id={id}
          role={editable ? "button" : undefined}
          tabIndex={editable ? 0 : undefined}
          aria-label={editable ? "Edit comment on highlighted text" : undefined}
          onClick={(event) => {
            // Dragging or long-pressing a saved passage must keep native
            // selection/copying intact, rather than opening its editor.
            if (!id || !onAnnotationEdit || window.getSelection()?.isCollapsed === false) return;
            event.preventDefault();
            event.stopPropagation();
            const element = event.currentTarget;
            onAnnotationEdit(id, () => element.getBoundingClientRect());
          }}
          onKeyDown={(event) => {
            if (
              !id ||
              !onAnnotationEdit ||
              event.nativeEvent.isComposing ||
              (event.key !== "Enter" && event.key !== " ")
            )
              return;
            event.preventDefault();
            event.stopPropagation();
            const element = event.currentTarget;
            onAnnotationEdit(id, () => element.getBoundingClientRect());
          }}
        >
          {segment}
        </mark>
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
      case "paragraph":
        return <p key={index}>{content}</p>;
      case "heading": {
        const Heading = `h${part.depth ?? 2}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
        return <Heading key={index}>{content}</Heading>;
      }
      case "blockquote":
        return <blockquote key={index}>{content}</blockquote>;
      case "list":
        return part.ordered ? (
          <ol key={index} start={part.listStart}>
            {content}
          </ol>
        ) : (
          <ul key={index}>{content}</ul>
        );
      case "listItem":
        return (
          <li key={index} className={typeof part.checked === "boolean" ? styles.task : undefined}>
            {typeof part.checked === "boolean" ? (
              <input
                type="checkbox"
                checked={part.checked}
                disabled
                aria-label={part.checked ? "Completed task" : "Incomplete task"}
              />
            ) : null}
            {content}
          </li>
        );
      case "codeBlock":
        return (
          <ChatCodeBlock key={index} value={part.value ?? ""} language={part.language}>
            {content}
          </ChatCodeBlock>
        );
      case "table":
        return (
          <div
            key={index}
            className={styles["table-scroll"]}
            tabIndex={0}
            role="region"
            aria-label="Message table"
          >
            <table>
              <tbody>{content}</tbody>
            </table>
          </div>
        );
      case "tableRow":
        return <tr key={index}>{content}</tr>;
      case "tableCell": {
        const Cell = part.header ? "th" : "td";
        return (
          <Cell
            key={index}
            scope={part.header ? "col" : undefined}
            data-align={part.align ?? undefined}
          >
            {content}
          </Cell>
        );
      }
      case "break":
        return (
          <Fragment key={index}>
            {content}
            <br />
          </Fragment>
        );
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

  return (
    <div
      className={styles.message}
      data-ui="chat-message-text"
      data-annotation-source={annotationSource}
    >
      {emphasizeLabels ? <p>{parts.map(render)}</p> : parts.map(render)}
    </div>
  );
}
