import { describe, expect, it } from "vitest";
import { splitMessageLinks } from "./chatMessageLinks";

describe("splitMessageLinks", () => {
  it("turns HTTP URLs into links without swallowing sentence punctuation", () => {
    expect(splitMessageLinks("See https://example.com/docs?q=chat, then continue.")).toEqual([
      "See ",
      { href: "https://example.com/docs?q=chat", text: "https://example.com/docs?q=chat" },
      ", then continue.",
    ]);
  });

  it("removes matching Markdown emphasis from the link destination", () => {
    expect(splitMessageLinks("Open **https://example.com/page**.")).toEqual([
      "Open **",
      { href: "https://example.com/page", text: "https://example.com/page" },
      "**.",
    ]);
    expect(splitMessageLinks("Read `https://example.com/docs`.")).toEqual([
      "Read `",
      { href: "https://example.com/docs", text: "https://example.com/docs" },
      "`.",
    ]);
  });

  it("preserves valid URL characters when they are not Markdown delimiters", () => {
    expect(splitMessageLinks("Open https://example.com/file_name_")).toEqual([
      "Open ",
      { href: "https://example.com/file_name_", text: "https://example.com/file_name_" },
    ]);
  });

  it("supports bare www URLs and balanced parentheses", () => {
    expect(splitMessageLinks("Try www.example.com/a_(b).")).toEqual([
      "Try ",
      { href: "https://www.example.com/a_(b)", text: "www.example.com/a_(b)" },
      ".",
    ]);
  });

  it("does not link unsupported URL schemes", () => {
    expect(splitMessageLinks("Do not open javascript:alert(1) or file:///tmp/test")).toEqual([
      "Do not open javascript:alert(1) or file:///tmp/test",
    ]);
  });
});
