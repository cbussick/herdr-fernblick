import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmTableFromMarkdown } from "mdast-util-gfm-table";
import { gfmTaskListItemFromMarkdown } from "mdast-util-gfm-task-list-item";
import { gfmTable } from "micromark-extension-gfm-table";
import { gfmTaskListItem } from "micromark-extension-gfm-task-list-item";
import type { Nodes } from "mdast";
import { splitMessageLinks } from "./chatMessageLinks";

type TextPart =
  | { kind: "text"; start: number; end: number }
  | { kind: "syntax"; start: number; end: number };
type FormattedPart = {
  kind:
    | "strong"
    | "emphasis"
    | "code"
    | "link"
    | "paragraph"
    | "heading"
    | "blockquote"
    | "list"
    | "listItem"
    | "codeBlock"
    | "table"
    | "tableRow"
    | "tableCell"
    | "break";
  start: number;
  end: number;
  href?: string;
  depth?: 1 | 2 | 3 | 4 | 5 | 6;
  ordered?: boolean;
  listStart?: number;
  checked?: boolean | null;
  language?: string;
  value?: string;
  header?: boolean;
  align?: "left" | "right" | "center" | null;
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

// Every leaf covers an original source range, including non-visible syntax.
// Capture container prefixes from the parser rather than guessing with regexes:
// nested quotes/lists, lazy continuation lines and tabs all retain raw offsets.
export function formatMessageText(text: string): MessagePart[] {
  const prefixes: { start: number; end: number }[] = [];
  const fences: { start: number; end: number }[] = [];
  const tree = fromMarkdown(text, {
    extensions: [gfmTable(), gfmTaskListItem()],
    mdastExtensions: [
      gfmTableFromMarkdown(),
      gfmTaskListItemFromMarkdown(),
      {
        beforeEnter(token) {
          const range = { start: token.start.offset, end: token.end.offset };
          if (
            ["blockQuotePrefix", "listItemPrefix", "listItemIndent", "linePrefix"].includes(
              token.type,
            )
          )
            prefixes.push(range);
          if (token.type === "codeFencedFence") fences.push(range);
        },
      },
    ],
  });
  const literal = (start: number, end: number): TextPart => ({ kind: "text", start, end });
  const syntax = (start: number, end: number): TextPart => ({ kind: "syntax", start, end });

  function sourceText(start: number, end: number, autolink = false): MessagePart[] {
    const parts: MessagePart[] = [];
    let offset = start;
    for (const prefix of prefixes) {
      if (prefix.end <= offset || prefix.start >= end) continue;
      if (prefix.start > offset)
        parts.push(
          ...(autolink ? textParts(offset, prefix.start) : [literal(offset, prefix.start)]),
        );
      const next = Math.min(end, prefix.end);
      parts.push(syntax(Math.max(offset, prefix.start), next));
      offset = next;
    }
    if (offset < end) parts.push(...(autolink ? textParts(offset, end) : [literal(offset, end)]));
    return parts;
  }

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

  // UL/OL/TR/TABLE cannot contain syntax spans directly. Place their separators
  // inside the adjacent LI/TD, preserving source order and valid HTML nesting.
  function insertSyntax(part: MessagePart, gap: TextPart, before: boolean) {
    if (!("children" in part)) return;
    if (part.kind === "tableRow") {
      const cell = before ? part.children[0] : part.children.at(-1);
      if (cell) insertSyntax(cell, gap, before);
    } else if (before) part.children.unshift(gap);
    else part.children.push(gap);
  }

  function children(
    nodes: Nodes[],
    start: number,
    end: number,
    autolink = true,
    gaps: "text" | "syntax" | "inside" = "text",
  ): MessagePart[] {
    const parts: MessagePart[] = [];
    let offset = start;
    for (const node of nodes) {
      const nodeStart = node.position?.start.offset;
      const nodeEnd = node.position?.end.offset;
      if (nodeStart === undefined || nodeEnd === undefined) continue;
      const formatted = format(node, nodeStart, nodeEnd, autolink);
      if (nodeStart > offset) {
        const gap = gaps === "text" ? literal(offset, nodeStart) : syntax(offset, nodeStart);
        if (gaps === "inside" && formatted[0]) insertSyntax(formatted[0], gap, true);
        else parts.push(gap);
      }
      parts.push(...formatted);
      offset = nodeEnd;
    }
    if (offset < end) {
      const gap = gaps === "text" ? literal(offset, end) : syntax(offset, end);
      if (gaps === "inside" && parts.at(-1)) insertSyntax(parts.at(-1)!, gap, false);
      else parts.push(gap);
    }
    return parts;
  }

  function format(node: Nodes, start: number, end: number, autolink: boolean): MessagePart[] {
    if (node.type === "text") return sourceText(start, end, autolink);
    if (node.type === "code") {
      const nodeFences = fences.filter((fence) => fence.start >= start && fence.end <= end);
      let contentStart = start;
      let contentEnd = end;
      if (nodeFences.length) {
        const openingEol = /\r\n|\r|\n/.exec(text.slice(nodeFences[0].end, end));
        contentStart = openingEol
          ? nodeFences[0].end + openingEol.index + openingEol[0].length
          : end;
        if (nodeFences.length > 1) {
          const closingLine =
            Math.max(
              text.lastIndexOf("\n", nodeFences[1].start - 1),
              text.lastIndexOf("\r", nodeFences[1].start - 1),
            ) + 1;
          contentEnd = Math.max(contentStart, closingLine);
        }
        // CommonMark removes one terminal line ending even for an open fence.
        const trailingEol = /(?:\r\n|\r|\n)$/.exec(text.slice(contentStart, contentEnd));
        if (trailingEol) contentEnd -= trailingEol[0].length;
      }
      return [
        {
          kind: "codeBlock",
          start,
          end,
          value: node.value,
          language: node.lang ?? undefined,
          children: [
            syntax(start, contentStart),
            ...sourceText(contentStart, contentEnd),
            syntax(contentEnd, end),
          ],
        },
      ];
    }
    if (node.type === "break")
      return [{ kind: "break", start, end, children: [syntax(start, end)] }];
    if (
      node.type === "paragraph" ||
      node.type === "heading" ||
      node.type === "blockquote" ||
      node.type === "list" ||
      node.type === "listItem" ||
      node.type === "table" ||
      node.type === "tableRow" ||
      node.type === "tableCell"
    ) {
      const part: FormattedPart = {
        kind: node.type,
        start,
        end,
        children: children(
          node.children,
          start,
          end,
          autolink,
          ["list", "table", "tableRow"].includes(node.type) ? "inside" : "syntax",
        ),
      };
      if (node.type === "heading") part.depth = node.depth;
      if (node.type === "list") {
        part.ordered = node.ordered ?? false;
        part.listStart = node.start ?? undefined;
      }
      if (node.type === "listItem") part.checked = node.checked;
      if (node.type === "table") {
        part.children.forEach((row, rowIndex) => {
          if (!("children" in row)) return;
          row.children.forEach((cell, column) => {
            if (!("children" in cell)) return;
            cell.header = rowIndex === 0;
            cell.align = node.align?.[column];
          });
        });
      }
      return [part];
    }
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

  return children(tree.children, 0, text.length, true, "syntax");
}
