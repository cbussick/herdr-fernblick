import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChatMessageText } from "./ChatMessageText";

describe("ChatMessageText formatting", () => {
  it("renders the screenshot's Markdown image as a linked, lazy inline preview", () => {
    const src = "http://100.71.229.1:8790/xr-matching-redesign.png";
    const html = renderToStaticMarkup(
      <ChatMessageText text={`![Generated matching-exercise redesign](${src} "Concept")`} />,
    );
    expect(html).toContain(`href="${src}"`);
    expect(html).toContain(`src="${src}"`);
    expect(html).toContain('alt="Generated matching-exercise redesign"');
    expect(html).toContain('title="Concept"');
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('referrerPolicy="no-referrer"');
    expect(html).not.toContain("![");
  });

  it("renders absolute local image paths through the backend without changing annotation text", () => {
    const text = "Before ![Logo](</tmp/logo draft #1.png>) **after**.";
    const src = "/api/local-images?path=%2Ftmp%2Flogo%20draft%20%231.png";
    const html = renderToStaticMarkup(<ChatMessageText text={text} />);
    expect(html).toContain(`src="${src}"`);
    expect(html).toContain(`href="${src}"`);
    expect(html).toContain('alt="Logo"');
    expect(html).not.toContain("![");
    for (let end = 0; end <= text.length; end++) {
      const partial = text.slice(0, end);
      const annotated = renderToStaticMarkup(
        <ChatMessageText text={partial} annotationSource="a1" />,
      );
      expect(annotated.replace(/<[^>]+>/g, "")).toBe(renderToStaticMarkup(<>{partial}</>));
    }
  });

  it("does not load local paths from prose, ordinary links, code, escaped images or unsupported destinations", () => {
    const html = renderToStaticMarkup(
      <ChatMessageText
        text={
          "/tmp/a.png [file](/tmp/a.png) `![code](/tmp/a.png)` \\![escaped](/tmp/a.png)\n\n```md\n![code](/tmp/a.png)\n```\n\n![relative](./a.png) ![network](//host/a.png) ![file](file:///tmp/a.png) ![null](/tmp/a%00.png)"
        }
      />,
    );
    expect(html).not.toContain("<img");
    expect(html).not.toContain("/api/local-images");
  });

  it("renders relative image previews without changing raw annotation source ranges", () => {
    const text = "Before ![Preview](<./design/Logo #1.png>) **after**.";
    const src = "/api/local-images?path=%2Fworkspace%2Fproject%2F.%2Fdesign%2FLogo%20%231.png";
    const html = renderToStaticMarkup(<ChatMessageText text={text} cwd="/workspace/project" />);
    expect(html).toContain(`src="${src}"`);
    expect(html).toContain(`href="${src}"`);
    for (let end = 0; end <= text.length; end++) {
      const partial = text.slice(0, end);
      const annotated = renderToStaticMarkup(
        <ChatMessageText text={partial} cwd="/workspace/project" annotationSource="a1" />,
      );
      expect(annotated.replace(/<[^>]+>/g, "")).toBe(renderToStaticMarkup(<>{partial}</>));
    }
  });

  it("resolves only image destinations, not links, code, escaped images or unsafe schemes even with a cwd", () => {
    const html = renderToStaticMarkup(
      <ChatMessageText
        cwd="/workspace/project"
        text={
          "./a.png [file](./a.png) `![code](./a.png)` \\![escaped](./a.png)\n\n```md\n![code](./a.png)\n```\n\n![file](file:///tmp/a.png) ![network](//host/a.png) ![data](data:image/png;base64,AA) ![scheme](javascript%3Aalert%281%29)"
        }
      />,
    );
    expect(html).not.toContain("<img");
    expect(html).not.toContain("/api/local-images");
  });

  it("decodes URL-encoded local names once", () => {
    const html = renderToStaticMarkup(<ChatMessageText text="![Logo](/tmp/logo%20%2520%3F.png)" />);
    expect(html).toContain('src="/api/local-images?path=%2Ftmp%2Flogo%20%2520%3F.png"');
  });

  it("does not nest anchors for linked images", () => {
    const html = renderToStaticMarkup(
      <ChatMessageText text="[![Preview](https://example.com/image.png)](https://example.com/page)" />,
    );
    expect(html.match(/<a /g)).toHaveLength(1);
    expect(html).toContain('href="https://example.com/page"');
    expect(html).toContain("<img ");
  });

  it("keeps unsafe images, unresolved references, and code examples literal", () => {
    const html = renderToStaticMarkup(
      <ChatMessageText
        text={
          "![bad](javascript:alert%281%29) ![data](data:image/png;base64,AA) ![local](file:///tmp/a.png) ![unknown][ref]\n\n`![example](https://example.com/a.png)`\n\n```md\n![example](https://example.com/a.png)\n```"
        }
      />,
    );
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<a ");
  });

  it("preserves raw annotation offsets around images throughout streaming", () => {
    const text = "Before ![A & B](https://example.com/a_(b).png) **after**.";
    for (let end = 0; end <= text.length; end++) {
      const html = renderToStaticMarkup(
        <ChatMessageText text={text.slice(0, end)} annotationSource="a1" />,
      );
      expect(html.replace(/<[^>]+>/g, "")).toBe(renderToStaticMarkup(<>{text.slice(0, end)}</>));
    }
  });

  it("renders bare URLs without swallowing punctuation or valid path characters", () => {
    const html = renderToStaticMarkup(
      <ChatMessageText text="See https://example.com/docs?q=chat, **https://example.com/file_name_** and www.example.com/a_(b)." />,
    );
    expect(html).toContain('href="https://example.com/docs?q=chat"');
    expect(html).toContain('href="https://example.com/file_name_"');
    expect(html).toContain('href="https://www.example.com/a_(b)"');
    expect(html.match(/<a /g)).toHaveLength(3);
  });

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
});
