import { expect, it } from "vitest";
import { terminalTextSpans } from "./terminalText";

it("maps the actual footer's RGB, dim separators and resets into bounded styles", () => {
  expect(
    terminalTextSpans(
      "\x1b[22m\x1b[38;2;246;226;183;49mmodel high\x1b[2m\x1b[39;49m · \x1b[22m\x1b[38;2;171;223;167;49m~/cwd\x1b[39m\x1b[49m\x1b[0m",
    ),
  ).toEqual([
    { text: "model high", style: { color: "rgb(246, 226, 183)" } },
    { text: " · ", style: { opacity: 0.65 } },
    { text: "~/cwd", style: { color: "rgb(171, 223, 167)" } },
  ]);
  expect(terminalTextSpans("\x1b[2m↑20k $1.234\x1b[0m plain")).toEqual([
    { text: "↑20k $1.234", style: { opacity: 0.65 } },
    { text: " plain", style: {} },
  ]);
});

it("supports status text's basic/bright/indexed colors and attributes without style injection", () => {
  const spans = terminalTextSpans(
    "\x1b[1;3;4;31;44mstyled\x1b[22;23;24;39;49mreset\x1b[38;5;196;48;5;232mpalette\x1b[38;5;16mblack\x1b[91;107mbright",
  );
  expect(spans[0]).toEqual({
    text: "styled",
    style: {
      fontWeight: "bold",
      fontStyle: "italic",
      textDecoration: "underline",
      color: "#cd0000",
      backgroundColor: "#0000ee",
    },
  });
  expect(spans[1]).toEqual({ text: "reset", style: {} });
  expect(spans[2].style).toEqual({ color: "rgb(255, 0, 0)", backgroundColor: "rgb(8, 8, 8)" });
  expect(spans[3].style.color).toBe("rgb(0, 0, 0)");
  expect(spans[4].style).toEqual({ color: "#ff0000", backgroundColor: "#ffffff" });
  expect(
    terminalTextSpans("\x1b[38;2;999;0;0mbad\x1b[38;5;256mindex\x1b[38;2;1mshort").map(
      (s) => s.style,
    ),
  ).toEqual([{}, {}, {}]);
});

it.each([
  ["left\x1b]8;;javascript:alert(1)\x07link\x1b]8;;\x1b\\right", "leftlinkright"],
  ["left\x1b]52;c;secret\x07right", "leftright"],
  ["left\x1bPprivate payload\x1b\\right", "leftright"],
  ["left\x9d8;;https://evil\x9clink\x9d8;;\x9c", "leftlink"],
  ["left\x1b]unterminated payload", "left"],
  ["left\x1b[", "left"],
  ["left\x1b[2J\x1b[1A\x1b(Bright", "leftright"],
  ["a\x00\x07b\r\n\tc\x7f\x81", "ab   c"],
  ["<script>alert('x')</script> 🐑 中文", "<script>alert('x')</script> 🐑 中文"],
])("treats control/HTML input as inert text: %j", (input, expected) => {
  expect(
    terminalTextSpans(input)
      .map((span) => span.text)
      .join(""),
  ).toBe(expected);
});
