import { fromMarkdown } from "mdast-util-from-markdown";
import type { Nodes } from "mdast";

// Translate paired LaTeX delimiters into equal-length dollar delimiters before
// Markdown parsing. Original UTF-16 offsets (including annotation ranges) survive.
// Never translate code, HTML, link destinations or image paths.
export function normalizeMathDelimiters(text: string) {
  if (!text.includes("\\(") && !text.includes("\\[")) return text;
  const protectedRanges: { start: number; end: number }[] = [];
  function visit(node: Nodes) {
    if (["code", "inlineCode", "html", "link", "image", "definition"].includes(node.type)) {
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      if (start !== undefined && end !== undefined) protectedRanges.push({ start, end });
    } else if ("children" in node) node.children.forEach(visit);
  }
  visit(fromMarkdown(text));
  return text.replace(
    /\\\(([\s\S]*?)\\\)|\\\[([\s\S]*?)\\\]/g,
    (match: string, _inline, _display, start: number) => {
      const end = start + match.length;
      const preceding = /\\+$/.exec(text.slice(0, start))?.[0].length ?? 0;
      if (preceding % 2 || protectedRanges.some((range) => range.start < end && range.end > start))
        return match;
      return `$$${match.slice(2, -2)}$$`;
    },
  );
}
