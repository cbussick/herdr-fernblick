import { expect, it } from "vitest";
import { splitMessageLinks } from "./chatMessageLinks";

it.each(["😀", "👩‍💻", "é"])(
  "preserves Unicode URL text while trimming unmatched ASCII delimiters: %s",
  (suffix) => {
    const url = `https://example.com/(page)/${suffix}`;
    expect(splitMessageLinks(`See (${url}).`)).toEqual(["See (", { text: url, href: url }, ")."]);
  },
);

it("retains balanced nested URL delimiters and strips only unmatched closers", () => {
  const url = "https://example.com/a(b[c]{d})";
  expect(splitMessageLinks(`${url}])`)).toEqual([{ text: url, href: url }, "])"]);
});
