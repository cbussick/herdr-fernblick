import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChatMessageText } from "./ChatMessageText";
import { ChatCodeText } from "./ChatCodeText";
import styles from "./ChatCodeText.module.css";

describe("chat syntax highlighting", () => {
  function code(value: string, language?: string) {
    return renderToStaticMarkup(
      <ChatCodeText
        value={value}
        language={language}
        renderRange={(start, end) => value.slice(start, end)}
      />,
    );
  }

  it.each(["ts", "typescript", "TS", "js", "javascript"])(
    "colors %s keywords, strings and comments",
    (language) => {
      const html = code('const greeting = "hello"; // note', language);
      expect(html).toContain(`class="${styles.keyword}"`);
      expect(html).toContain(`class="${styles.string}"`);
      expect(html).toContain(`class="${styles.comment}"`);
      expect(html.replace(/<[^>]*>/g, "")).toBe("const greeting = &quot;hello&quot;; // note");
    },
  );

  it.each([undefined, "text", "unknown-language"])(
    "leaves %s code plain and safely escaped",
    (language) => {
      expect(code('<script>alert("x")</script>', language)).toBe(
        "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;",
      );
    },
  );

  it("preserves multiline text and incomplete streaming code", () => {
    const value = '/* comment\n  still a comment */\nconst x = "unfinished';
    expect(code(value, "ts").replace(/<[^>]*>/g, "")).toBe(value.replace('"', "&quot;"));
  });

  it("bounds highlighting work for very large code blocks", () => {
    const value = "const x = 1;\n".repeat(5000);
    expect(code(value, "ts")).toBe(value);
  });

  it("keeps annotation offsets, hidden fences and escaping intact", () => {
    const text = '```ts\nconst x = "<tag>";\n```';
    const start = text.indexOf("const");
    const html = renderToStaticMarkup(
      <ChatMessageText
        text={text}
        annotationSource="message-1"
        highlights={[{ id: "note", start: start + 1, end: start + 8 }]}
      />,
    );
    expect(html).toContain(`class="${styles.keyword}"`);
    expect(html).toContain('data-annotation-id="note"');
    expect(html).toContain('data-message-syntax="true"');
    expect(html).toContain("&lt;tag&gt;");
    expect(html).not.toContain("<tag>");
    expect(html.replace(/<[^>]*>/g, "")).toContain(
      "```ts\nconst x = &quot;&lt;tag&gt;&quot;;\n```",
    );
  });
});
