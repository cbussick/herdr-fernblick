import type { ChatMessage } from "../../../packages/pi-live-chat/protocol";

export type AnnotationSource = {
  messageId: string;
  quote: string;
  start: number;
  end: number;
};
export type Annotation = AnnotationSource & { id: string; comment: string };
export type TextHighlight = { start: number; end: number };

export const annotationPromptIntro =
  "Please address these comments on your earlier responses. Each quoted passage is context; the comment below it is my feedback.";

// Like Plannotator, keep the original passage next to its feedback. Message IDs and
// offsets disambiguate repeated passages and comments on older assistant responses.
export function annotationPrompt(annotations: Annotation[]) {
  return [
    annotationPromptIntro,
    ...annotations.map(
      (annotation, index) =>
        `**Comment ${index + 1}** (response ${annotation.messageId}, characters ${annotation.start + 1}–${annotation.end})\n\n${annotation.quote
          .split("\n")
          .map((line) => `> ${line}`)
          .join("\n")}\n\n${annotation.comment}`,
    ),
  ].join("\n\n");
}

export function annotationHighlights(message: ChatMessage, annotations: Annotation[]) {
  return annotations.filter(
    (entry) =>
      entry.messageId === message.id && message.text.slice(entry.start, entry.end) === entry.quote,
  );
}

export function readAnnotationSelection(
  selection: Selection | null,
  transcript: HTMLElement,
  messages: ChatMessage[],
): { source: AnnotationSource; range: Range } | null {
  if (!selection || selection.isCollapsed || selection.rangeCount !== 1) return null;
  const range = selection.getRangeAt(0);
  const element =
    range.startContainer.nodeType === 1
      ? (range.startContainer as Element)
      : range.startContainer.parentElement;
  const source = element?.closest<HTMLElement>("[data-annotation-source]");
  // Never accept a selection crossing messages or including names, tool output,
  // thinking, user text, or controls, even if it starts in an assistant response.
  if (
    !source ||
    !transcript.contains(source) ||
    !source.contains(range.startContainer) ||
    !source.contains(range.endContainer)
  )
    return null;
  const message = messages.find(
    (entry) => entry.id === source.dataset.annotationSource && entry.role === "assistant",
  );
  if (!message) return null;
  const raw = range.toString();
  const quote = raw.trim();
  if (!quote) return null;
  const prefix = range.cloneRange();
  prefix.selectNodeContents(source);
  prefix.setEnd(range.startContainer, range.startOffset);
  const start = prefix.toString().length + raw.length - raw.trimStart().length;
  const end = start + quote.length;
  if (message.text.slice(start, end) !== quote) return null;
  return { source: { messageId: message.id, quote, start, end }, range: range.cloneRange() };
}

export function positionAnnotationPopover(
  anchor: { left: number; top: number; bottom: number },
  size: { width: number; height: number },
  viewport: { left: number; top: number; width: number; height: number },
  preferBelow = false,
) {
  const gap = 12;
  const left = Math.max(
    viewport.left + gap,
    Math.min(anchor.left, viewport.left + viewport.width - size.width - gap),
  );
  const above = anchor.top - size.height - gap;
  const below = anchor.bottom + gap;
  const preferred =
    preferBelow && below + size.height <= viewport.top + viewport.height - gap
      ? below
      : above >= viewport.top + gap
        ? above
        : below;
  const top = Math.max(
    viewport.top + gap,
    Math.min(preferred, viewport.top + viewport.height - size.height - gap),
  );
  return { left, top };
}
