import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChatMessageText } from "./ChatMessageText";

describe("chat math", () => {
  it("renders the screenshot's display equation instead of interpreting its equals sign as a heading", () => {
    const text = String.raw`Damit lautet die Umrechnung:

\[
\boxed{p_\text{Nagel}
=
M_\text{Nagel}^{-1} M_\text{Straße}^{-1} M_\text{Auto} M_\text{Rad} \,p_\text{Rad}}
\]`;
    const html = renderToStaticMarkup(<ChatMessageText text={text} />);
    expect(html).toContain("<math");
    expect(html).toContain('display="block"');
    expect(html).not.toMatch(/<h[1-6]/);
  });

  it.each([String.raw`\(x^2\)`, "$x^2$", "$$x^2$$", "$$\nx^2\n$$", String.raw`\[x^2\]`])(
    "renders %s",
    (text) => {
      expect(renderToStaticMarkup(<ChatMessageText text={text} />)).toContain("<math");
    },
  );

  it("preserves raw formula offsets for annotations", () => {
    const text = String.raw`Before \(x^2\) **after**`;
    const html = renderToStaticMarkup(<ChatMessageText text={text} annotationSource="message-1" />);
    expect(html).toContain("<math");
    expect(html).toContain(String.raw`\(x^2\)</span>`);
    expect(html).toContain("data-message-control");
    expect(html).toContain("after");
  });

  it("falls back safely on invalid and untrusted TeX", () => {
    const invalid = String.raw`\(\unknowncommand{x}\)`;
    expect(renderToStaticMarkup(<ChatMessageText text={invalid} />)).toContain(invalid);
    const unsafe = renderToStaticMarkup(
      <ChatMessageText text={String.raw`\(\href{javascript:alert(1)}{click}\)`} />,
    );
    expect(unsafe).not.toContain('href="javascript:');
  });

  it("does not normalize escaped delimiters or code and link destinations", () => {
    for (const text of [
      String.raw`\\(x\\)`,
      "`\\(x\\)`",
      String.raw`[example](https://example.com/\(x\))`,
    ]) {
      expect(renderToStaticMarkup(<ChatMessageText text={text} />)).not.toContain("<math");
    }
  });

  it("keeps code examples and incomplete streaming formulas literal", () => {
    for (const text of [
      "`$x$`",
      "```tex\n\\[x\\]\n```",
      String.raw`\(x`,
      String.raw`\[x`,
      "$$\nx^2",
    ]) {
      expect(renderToStaticMarkup(<ChatMessageText text={text} />)).not.toContain("<math");
    }
  });
});
