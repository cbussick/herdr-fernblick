const URL_PATTERN = /\b(?:https?:\/\/|www\.)[^\s<>"']+/giu;
const TRAILING_PUNCTUATION = /[.,!?;:]+$/u;
const MARKDOWN_DELIMITERS = ["***", "___", "**", "__", "~~", "``", "*", "_", "`"];
const CLOSING_DELIMITERS = new Map([
  [")", "("],
  ["]", "["],
  ["}", "{"],
]);

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
  if (markdownDelimiter) {
    url = url.slice(0, -markdownDelimiter.length);
  }

  while (url.length) {
    const closing = url.at(-1);
    const opening = closing ? CLOSING_DELIMITERS.get(closing) : undefined;
    if (!opening) {
      break;
    }

    // Delimiters are ASCII; count them without splitting Unicode URL text.
    let openingCount = 0;
    let closingCount = 0;
    for (const character of url) {
      if (character === opening) {
        openingCount++;
      } else if (character === closing) {
        closingCount++;
      }
    }
    if (closingCount <= openingCount) {
      break;
    }
    url = url.slice(0, -1);
  }

  return url;
}

export function splitMessageLinks(text: string): Array<MessageTextPart> {
  const parts: Array<MessageTextPart> = [];
  let previousEnd = 0;

  for (const match of text.matchAll(URL_PATTERN)) {
    const start = match.index;
    const candidate = match[0];
    const linkText = trimLinkEnd(candidate, text.slice(0, start));

    if (start > previousEnd) {
      parts.push(text.slice(previousEnd, start));
    }
    parts.push({
      text: linkText,
      href: linkText.startsWith("www.") ? `https://${linkText}` : linkText,
    });
    previousEnd = start + linkText.length;
  }

  if (previousEnd < text.length) {
    parts.push(text.slice(previousEnd));
  }
  return parts;
}
