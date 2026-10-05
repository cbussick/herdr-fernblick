import { describe, expect, it } from "vitest";
import { formatMessageText, type MessagePart } from "./chatMessageFormatting";

function leaves(parts: MessagePart[]): MessagePart[] {
  return parts.flatMap((part) => ("children" in part ? leaves(part.children) : [part]));
}

describe("formatMessageText source ranges", () => {
  it.each([
    "",
    "plain text\n\nmore text",
    "**[Open app → https://example.com](https://example.com)**",
    "# Heading\n\n- **bold**\n  - *nested*",
    "> first **bold**\n> second [link](https://example.com)",
    "***nested*** and **more *nested* text**",
    "`https://example.com` and `` code ` example ``",
    "```md\n[Docs](https://example.com)\n```",
    "[empty](https://example.com) [](https://example.com)",
    "<https://example.com> <script>evil</script>",
    "[relative](./file) [bad](javascript:alert%281%29)",
    "[reference][ref]\n\n[ref]: https://example.com",
    "![image](https://example.com/a.png)",
    "[[https://example.com|Docs]] [[My note]]",
    "\\[[https://example.com|Docs]] and &amp; and \\*literal\\*",
    "**incomplete [stream](https://example.com",
    "😀 [emoji](https://example.com)\r\nnext line",
  ])("covers every raw character exactly once: %s", (text) => {
    const parts = leaves(formatMessageText(text));
    let offset = 0;
    for (const part of parts) {
      expect(part.start).toBe(offset);
      expect(part.end).toBeGreaterThanOrEqual(part.start);
      offset = part.end;
    }
    expect(offset).toBe(text.length);
    expect(parts.map((part) => text.slice(part.start, part.end)).join("")).toBe(text);
  });
});
