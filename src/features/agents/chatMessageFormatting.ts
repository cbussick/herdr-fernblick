import { fromMarkdown } from "mdast-util-from-markdown";
import type { Nodes } from "mdast";
import { splitMessageLinks } from "./chatMessageLinks";

type TextPart =
  | { kind: "text"; start: number; end: number }
  | { kind: "syntax"; start: number; end: number };
type FormattedPart = {
  kind: "strong" | "emphasis" | "code" | "link";
  start: number;
  end: number;
  href?: string;
  children: MessagePart[];
};
export type MessagePart = TextPart | FormattedPart;

function webDestination(value: string) {
  const href = value.startsWith("www.") ? `https://${value}` : value;
  try {
    const url = new URL(href);
    return url.protocol === "http:" || url.protocol === "https:" ? href : undefined;
  } catch {
    return undefined;
  }
}

// Inline formatting only: keep message whitespace and block syntax unchanged.
// Every part covers an original source range, including the non-visible syntax.
// This lets annotation Range offsets remain anchored in the original message.
export function formatMessageText(text: string): MessagePart[] {
  const literal = (start: number, end: number): TextPart => ({ kind: "text", start, end });
  const syntax = (start: number, end: number): TextPart => ({ kind: "syntax", start, end });

  function bareLinks(start: number, end: number): MessagePart[] {
    let offset = start;
    return splitMessageLinks(text.slice(start, end)).map((part) => {
      const length = typeof part === "string" ? part.length : part.text.length;
      const content = literal(offset, offset + length);
      offset += length;
      return typeof part === "string" || !webDestination(part.href)
        ? content
        : { ...content, kind: "link", href: part.href, children: [content] };
    });
  }

  function textParts(start: number, end: number): MessagePart[] {
    const parts: MessagePart[] = [];
    let offset = start;
    // No vault resolver exists here. Only URL wikilinks are navigable; note
    // targets and incomplete/unsafe links stay literal instead of guessing URLs.
    for (const match of text.slice(start, end).matchAll(/\[\[([^\]\n]+)\]\]/g)) {
      const matchStart = start + match.index;
      const matchEnd = matchStart + match[0].length;
      parts.push(...bareLinks(offset, matchStart));
      const separator = match[1].indexOf("|");
      const target = separator === -1 ? match[1] : match[1].slice(0, separator);
      const backslashes = /\\+$/.exec(text.slice(start, matchStart))?.[0].length ?? 0;
      const href = backslashes % 2 === 0 ? webDestination(target) : undefined;
      const labelStart = matchStart + 2 + (separator === -1 ? 0 : separator + 1);
      const labelEnd = matchEnd - 2;
      if (href && labelStart < labelEnd) {
        parts.push({
          kind: "link",
          start: matchStart,
          end: matchEnd,
          href,
          children: [
            syntax(matchStart, labelStart),
            literal(labelStart, labelEnd),
            syntax(labelEnd, matchEnd),
          ],
        });
      } else {
        parts.push(literal(matchStart, matchEnd));
      }
      offset = matchEnd;
    }
    parts.push(...bareLinks(offset, end));
    return parts;
  }

  function children(nodes: Nodes[], start: number, end: number, autolink = true): MessagePart[] {
    const parts: MessagePart[] = [];
    let offset = start;
    for (const node of nodes) {
      const nodeStart = node.position?.start.offset;
      const nodeEnd = node.position?.end.offset;
      if (nodeStart === undefined || nodeEnd === undefined) continue;
      if (nodeStart > offset) parts.push(literal(offset, nodeStart));
      parts.push(...format(node, nodeStart, nodeEnd, autolink));
      offset = nodeEnd;
    }
    if (offset < end) parts.push(literal(offset, end));
    return parts;
  }

  function format(node: Nodes, start: number, end: number, autolink: boolean): MessagePart[] {
    if (node.type === "text") return autolink ? textParts(start, end) : [literal(start, end)];
    if (node.type === "inlineCode") {
      const delimiter = /^`+/.exec(text.slice(start, end))![0].length;
      return [
        {
          kind: "code",
          start,
          end,
          children: [
            syntax(start, start + delimiter),
            literal(start + delimiter, end - delimiter),
            syntax(end - delimiter, end),
          ],
        },
      ];
    }
    if (node.type === "strong" || node.type === "emphasis" || node.type === "link") {
      const href = node.type === "link" ? webDestination(node.url) : undefined;
      if (node.type === "link" && (!href || !node.children.length)) return [literal(start, end)];
      const contentStart = node.children[0]?.position?.start.offset ?? start;
      const contentEnd = node.children.at(-1)?.position?.end.offset ?? end;
      return [
        {
          kind: node.type,
          start,
          end,
          href,
          children: [
            syntax(start, contentStart),
            ...children(node.children, contentStart, contentEnd, autolink && node.type !== "link"),
            syntax(contentEnd, end),
          ],
        },
      ];
    }
    // Never autolink code examples, HTML, images or unresolved references.
    if ("children" in node && node.type !== "linkReference")
      return children(node.children, start, end, autolink);
    return [literal(start, end)];
  }

  return children(fromMarkdown(text).children, 0, text.length);
}
