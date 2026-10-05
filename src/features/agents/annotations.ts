import type { ChatMessage } from "../../../packages/pi-live-chat/protocol";

export type AnnotationSource = {
  messageId: string;
  quote: string;
  start: number;
  end: number;
};
// General feedback has no fabricated response ID, quote, or character offsets.
type GeneralSource = { messageId?: never; quote?: never; start?: never; end?: never };
export type Annotation = (AnnotationSource | GeneralSource) & { id: string; comment: string };
export type TextHighlight = { start: number; end: number };

export const annotationPromptIntro =
  "Please address these comments on your earlier responses. Each quoted passage is context; the comment below it is my feedback.";

export const annotationGeneralPromptIntro =
  "Please address these comments. Quoted passages are context for the feedback below them; general comments apply to the conversation as a whole.";

// Like Plannotator, keep the original passage next to its feedback. Message IDs and
// offsets disambiguate repeated passages and comments on older assistant responses.
export function annotationPrompt(annotations: Annotation[]) {
  return [
    annotations.some((entry) => entry.messageId === undefined)
      ? annotationGeneralPromptIntro
      : annotationPromptIntro,
    ...annotations.map((annotation, index) =>
      annotation.messageId === undefined
        ? `**Comment ${index + 1}** (general comment)\n\n${annotation.comment}`
        : `**Comment ${index + 1}** (response ${annotation.messageId}, characters ${annotation.start + 1}–${annotation.end})\n\n${annotation.quote
            .split("\n")
            .map((line) => `> ${line}`)
            .join("\n")}\n\n${annotation.comment}`,
    ),
  ].join("\n\n");
}

export function annotationHighlights(message: ChatMessage, annotations: Annotation[]) {
  return annotations.filter(
    (entry): entry is Annotation & AnnotationSource =>
      entry.messageId !== undefined &&
      entry.messageId === message.id &&
      message.text.slice(entry.start, entry.end) === entry.quote,
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

// This reserves *estimated* callout space, not a measured system-menu rectangle.
// iPad exposes neither its menu geometry nor a way to layer page UI above it.
export function positionTouchAnnotationAction(
  anchor: { left: number; right: number; top: number; bottom: number },
  size: { width: number; height: number },
  viewport: { left: number; top: number; width: number; height: number },
) {
  const inset = 12;
  const handleGap = 20;
  const calloutGap = 84;
  const leftEdge = viewport.left + inset;
  const rightEdge = viewport.left + viewport.width - inset;
  const topEdge = viewport.top + inset;
  const bottomEdge = viewport.top + viewport.height - inset;
  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, max));
  const middle = clamp(
    (Math.max(anchor.top, topEdge) + Math.min(anchor.bottom, bottomEdge) - size.height) / 2,
    topEdge,
    bottomEdge - size.height,
  );

  // Beside a multiline selection, stay within its vertical band rather than
  // protruding into the native menu above/below it or covering selection handles.
  if (middle >= anchor.top && middle + size.height <= anchor.bottom) {
    if (anchor.right >= leftEdge && anchor.right + handleGap + size.width <= rightEdge)
      return { left: anchor.right + handleGap, top: middle };
    if (anchor.left <= rightEdge && anchor.left - handleGap - size.width >= leftEdge)
      return { left: anchor.left - handleGap - size.width, top: middle };
  }
  const left = clamp(anchor.left, leftEdge, rightEdge - size.width);
  const below = anchor.bottom + calloutGap;
  if (below >= topEdge && below + size.height <= bottomEdge) return { left, top: below };
  const above = anchor.top - calloutGap - size.height;
  if (above >= topEdge && above + size.height <= bottomEdge) return { left, top: above };

  // A viewport-filling selection may leave no exterior slot. Keep the action
  // inside its visible band, not clamped back into an estimated callout area.
  return { left: clamp(anchor.right - size.width, leftEdge, rightEdge - size.width), top: middle };
}

export function positionAnnotationPopover(
  anchor: { left: number; top: number; bottom: number },
  size: { width: number; height: number },
  viewport: { left: number; top: number; width: number; height: number },
) {
  const gap = 12;
  const left = Math.max(
    viewport.left + gap,
    Math.min(anchor.left, viewport.left + viewport.width - size.width - gap),
  );
  const above = anchor.top - size.height - gap;
  const below = anchor.bottom + gap;
  const preferred = above >= viewport.top + gap ? above : below;
  const top = Math.max(
    viewport.top + gap,
    Math.min(preferred, viewport.top + viewport.height - size.height - gap),
  );
  return { left, top };
}
