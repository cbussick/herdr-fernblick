import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChatMessageText } from "./ChatMessageText";

describe("ChatMessageText formatting", () => {
  it("renders the screenshot's bold labeled link as one link, not two raw URLs", () => {
    const html = renderToStaticMarkup(
      <ChatMessageText text="**[Open the app → http://100.71.229.1:41227](http://100.71.229.1:41227)**" />,
    );
    expect(html).toContain('<strong><a href="http://100.71.229.1:41227"');
    expect(html).toContain(">Open the app → http://100.71.229.1:41227</a></strong>");
    expect(html.match(/<a /g)).toHaveLength(1);
    expect(html).not.toContain("**[");
  });

  it("renders URL wikilinks and aliases, leaving unresolved note targets literal", () => {
    const html = renderToStaticMarkup(
      <ChatMessageText text="[[https://example.com|Docs]] [[www.example.com]] [[My note|Note]]" />,
    );
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain(">Docs</a>");
    expect(html).toContain('href="https://www.example.com"');
    expect(html).toContain(">www.example.com</a>");
    expect(html).toContain("[[My note|Note]]");
  });

  it("formats ordinary user links too", () => {
    const html = renderToStaticMarkup(
      <ChatMessageText text="[Docs](https://example.com)" annotationFeedback />,
    );
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain(">Docs</a>");
    expect(html).not.toContain("[Docs]");
  });

  it("keeps escaped wikilinks and empty link labels literal", () => {
    const html = renderToStaticMarkup(
      <ChatMessageText text={"\\[[https://example.com|Docs]] [](https://example.com)"} />,
    );
    expect(html).not.toContain("<a ");
    expect(html).toContain("[[https://example.com|Docs]]");
    expect(html).toContain("[](https://example.com)");
  });

  it("handles nested formatting, balanced destination parentheses and optional titles", () => {
    const html = renderToStaticMarkup(
      <ChatMessageText text={'[*Read* docs](https://example.com/a_(b) "Docs") then **done**.'} />,
    );
    expect(html).toContain('href="https://example.com/a_(b)"');
    expect(html).toContain("><em>Read</em> docs</a>");
    expect(html).toContain("<strong>done</strong>");
    expect(html).not.toContain('title="Docs"');
  });

  it("does not activate Markdown or wiki URLs inside inline or fenced code", () => {
    const html = renderToStaticMarkup(
      <ChatMessageText
        text={"`[Docs](https://example.com)`\n\n```md\n[[https://example.com|Docs]]\n```"}
      />,
    );
    expect(html).toContain("<code");
    expect(html).toContain("[Docs](https://example.com)");
    expect(html).not.toContain("<a ");
  });

  it("escapes HTML and never activates unsafe destinations", () => {
    const html = renderToStaticMarkup(
      <ChatMessageText
        text={
          "[bad](javascript:alert%281%29) [[data:text/html,evil|bad]] [local](file:///tmp/a) <img src=x onerror=alert(1)>"
        }
      />,
    );
    expect(html).not.toContain("<a ");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("renders headings, ordered/nested lists and multiline blockquotes without markers", () => {
    const html = renderToStaticMarkup(
      <ChatMessageText
        text={
          "# Title\n\nSubtitle\n--------\n\n3. **First**\n   - nested\n4. Second\n\n> A quote\n> continued\n>\n> Another paragraph"
        }
      />,
    );
    expect(html).toContain("<h1>Title</h1>");
    expect(html).toContain("<h2>Subtitle</h2>");
    expect(html).toContain('<ol start="3"><li><p><strong>First</strong></p><ul>');
    expect(html).toContain(
      "<blockquote><p>A quote\ncontinued</p><p>Another paragraph</p></blockquote>",
    );
    expect(html).not.toContain("# Title");
    expect(html).not.toContain("&gt;");
  });

  it("renders fenced code literally with a copy control, including nested quotes/lists", () => {
    const html = renderToStaticMarkup(
      <ChatMessageText
        text={"> - ```js\n>   const value = '<img>';\n>     // https://example.com\n>   ```"}
      />,
    );
    expect(html).toContain('aria-label="Copy code"');
    expect(html).toContain(
      "<code>const value = &#x27;&lt;img&gt;&#x27;;\n  // https://example.com</code>",
    );
    expect(html).not.toContain("<a ");
    expect(html).not.toContain("```");
  });

  it("renders GFM tables, alignment and read-only task checkboxes for user messages", () => {
    const html = renderToStaticMarkup(
      <ChatMessageText
        annotationFeedback
        text={
          "| Name | Value |\n| :--- | ---: |\n| **bold** | `main` |\n\n- [x] Done\n- [ ] Pending"
        }
      />,
    );
    expect(html).toContain('<th scope="col" data-align="left">Name</th>');
    expect(html).toContain('<td data-align="right"><code');
    expect(html).toContain('type="checkbox" disabled="" aria-label="Completed task" checked=""');
    expect(html).toContain('type="checkbox" disabled="" aria-label="Incomplete task"');
    expect(html).not.toContain("| :---");
    expect(html).not.toContain("[x]");
  });

  it("does not lose source characters as incomplete streamed blocks are completed", () => {
    const text =
      "# Title\n\n> - [x] **done**\n>\n> ```js\n> const x = 1;\n> ```\n\n| A | B |\n| - | - |\n| a | b |";
    for (let end = 0; end <= text.length; end++) {
      const html = renderToStaticMarkup(
        <ChatMessageText text={text.slice(0, end)} annotationSource="a1" />,
      );
      // The control's text is intentionally not part of the annotation source.
      const sourceHtml = html.replace(
        /<div[^>]*data-message-control="[^"]*"[^>]*>.*?<\/div>/gs,
        "",
      );
      expect(sourceHtml.replace(/<[^>]+>/g, "")).toBe(
        renderToStaticMarkup(<>{text.slice(0, end)}</>),
      );
    }
  });

  it("keeps every raw character and highlight offset in assistant annotation sources", () => {
    const text = "Before **[Read docs](https://example.com)** then `main`.";
    const start = text.indexOf("Read docs");
    const html = renderToStaticMarkup(
      <ChatMessageText
        text={text}
        annotationSource="a1"
        highlights={[{ start, end: start + 9 }]}
      />,
    );
    expect(html.replace(/<[^>]+>/g, "")).toBe(text);
    expect(html).toContain("data-message-syntax");
    expect(html).toMatch(/<mark[^>]*>Read docs<\/mark>/);
    expect(html.match(/<a /g)).toHaveLength(1);
  });
});
