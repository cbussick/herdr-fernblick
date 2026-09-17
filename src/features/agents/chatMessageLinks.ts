const URL_PATTERN = /\b(?:https?:\/\/|www\.)[^\s<>"']+/giu;
const TRAILING_PUNCTUATION = /[.,!?;:]+$/u;
const MARKDOWN_DELIMITERS = ["***", "___", "**", "__", "~~", "``", "*", "_", "`"];
const CLOSING_DELIMITERS: Record<string, string> = {
  ")": "(",
  "]": "[",
  "}": "{",
};

interface LinkPart {
  href: string;
  text: string;
}

export type MessageTextPart = string | LinkPart;

function trimLinkEnd(candidate: string, precedingText: string) {
  let url = candidate.replace(TRAILING_PUNCTUATION, "");
  const markdownDelimiter = MARKDOWN_DELIMITERS.find(
    (delimiter) => precedingText.endsWith(delimiter) && url.endsWith(delimiter),
  );
  if (markdownDelimiter) url = url.slice(0, -markdownDelimiter.length);

  while (url.length) {
    const closing = url.at(-1);
    const opening = closing ? CLOSING_DELIMITERS[closing] : undefined;
    if (!opening) break;

    const openingCount = [...url].filter((character) => character === opening).length;
    const closingCount = [...url].filter((character) => character === closing).length;
    if (closingCount <= openingCount) break;
    url = url.slice(0, -1);
  }

  return url;
}

export function splitMessageLinks(text: string): MessageTextPart[] {
  const parts: MessageTextPart[] = [];
  let previousEnd = 0;

  for (const match of text.matchAll(URL_PATTERN)) {
    const start = match.index;
    const candidate = match[0];
    const linkText = trimLinkEnd(candidate, text.slice(0, start));

    if (start > previousEnd) parts.push(text.slice(previousEnd, start));
    parts.push({
      text: linkText,
      href: linkText.startsWith("www.") ? `https://${linkText}` : linkText,
    });
    previousEnd = start + linkText.length;
  }

  if (previousEnd < text.length) parts.push(text.slice(previousEnd));
  return parts;
}
