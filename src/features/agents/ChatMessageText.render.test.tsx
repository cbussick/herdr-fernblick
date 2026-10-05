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
