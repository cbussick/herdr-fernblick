import { describe, expect, it } from "vitest";
import { formatMessageText, type MessagePart } from "./chatMessageFormatting";

function leaves(parts: MessagePart[]): MessagePart[] {
  return parts.flatMap((part) => ("children" in part ? leaves(part.children) : [part]));
}

describe("formatMessageText source ranges", () => {
  it.each([
    "```js\nx\n",
    "```js\nx\n\n",
    "```js\nx\n\n```",
    "```js\rconst x=1;\r```",
    "```js\r\nx\r\n```",
    "    code\n    more",
    "  ```\n  code\n  ```",
    "> - ```\n>   code\n>   ```",
    "~~~\n\n  code\n\n~~~",
    "```\n```",
  ])("displays the same code payload it copies: %s", (text) => {
    function findCode(parts: MessagePart[]): MessagePart | undefined {
      for (const part of parts) {
        if (part.kind === "codeBlock") return part;
        if ("children" in part) {
          const found = findCode(part.children);
          if (found) return found;
        }
      }
    }
    const code = findCode(formatMessageText(text));
    expect(code && "children" in code).toBe(true);
    if (!code || !("children" in code)) return;
    const visible = leaves(code.children)
      .filter((part) => part.kind === "text")
      .map((part) => text.slice(part.start, part.end))
      .join("")
      .replace(/\r\n|\r/g, "\n");
    expect(visible).toBe(code.value);
  });
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
    "3. first\n   continued\n   - nested\n\n4. second",
    "> outer\n> > inner\n> > continued\n>\n> - [x] done\n>   next line\n> - [ ] pending",
    "> - ```js\n>   const a = 1;\n>     indent;\n>   ```",
    "## Heading ##\n\nSetext\n======\n\n### Incomplete **bold",
    "~~~js\n\n  x\n\n~~~\n\n```\n```\n\n```js",
    "```js\r\nconst x = 1;\r\n```",
    "```js\rconst x = 1;\r```",
    "    indented\n    code\n\nplain",
    "| **Name** | Value |\n| :--- | ---: |\n| a | `b` |\n| | |",
    "> | A | B |\n> | - | - |\n> | a | b |",
    "- | A | B |\n  | - | - |\n  | a | b |",
    "line  \nnext\\\nlast",
    "- [x] **done**\n\n  paragraph\n\n- [ ] not done",
    "\tcode\n\tmore",
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
