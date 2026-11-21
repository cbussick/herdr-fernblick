import { expect, it } from "vitest";
import { terminalTextSpans } from "./terminalText";

it("maps the actual footer's RGB, dim separators and resets into bounded styles", () => {
  expect(
    terminalTextSpans(
      "\u001b[22m\u001b[38;2;246;226;183;49mmodel high\u001b[2m\u001b[39;49m · \u001b[22m\u001b[38;2;171;223;167;49m~/cwd\u001b[39m\u001b[49m\u001b[0m",
    ),
  ).toEqual([
    { text: "model high", style: { color: "rgb(246, 226, 183)" } },
    { text: " · ", style: { dim: true } },
    { text: "~/cwd", style: { color: "rgb(171, 223, 167)" } },
  ]);
  expect(terminalTextSpans("\u001b[2m↑20k $1.234\u001b[0m plain")).toEqual([
    { text: "↑20k $1.234", style: { dim: true } },
    { text: " plain", style: {} },
  ]);
});

it("supports status text's basic/bright/indexed colors and attributes without style injection", () => {
  const spans = terminalTextSpans(
    "\u001b[1;3;4;31;44mstyled\u001b[22;23;24;39;49mreset\u001b[38;5;196;48;5;232mpalette\u001b[38;5;16mblack\u001b[91;107mbright",
  );
  expect(spans[0]).toEqual({
    text: "styled",
    style: {
      bold: true,
      italic: true,
      underline: true,
      color: "#cd0000",
      backgroundColor: "#0000ee",
    },
  });
  expect(spans[1]).toEqual({ text: "reset", style: {} });
  expect(spans[2].style).toEqual({ color: "rgb(255, 0, 0)", backgroundColor: "rgb(8, 8, 8)" });
  expect(spans[3].style.color).toBe("rgb(0, 0, 0)");
  expect(spans[4].style).toEqual({ color: "#ff0000", backgroundColor: "#ffffff" });
  expect(
    terminalTextSpans("\u001b[38;2;999;0;0mbad\u001b[38;5;256mindex\u001b[38;2;1mshort").map(
      (s) => s.style,
    ),
  ).toEqual([{}, {}, {}]);
});

it("tracks underline and strike independently across selective resets", () => {
  expect(terminalTextSpans("\u001b[4;9mA\u001b[29mB\u001b[9;24mC\u001b[0mD")).toEqual([
    { text: "A", style: { underline: true, strike: true } },
    { text: "B", style: { underline: true } },
    { text: "C", style: { strike: true } },
    { text: "D", style: {} },
  ]);
});

it.each([
  ["left\u001b]8;;javascript:alert(1)\u0007link\u001b]8;;\u001b\\right", "leftlinkright"],
  ["left\u001b]52;c;secret\u0007right", "leftright"],
  ["left\u001bPprivate payload\u001b\\right", "leftright"],
  ["left\u009d8;;https://evil\u009clink\u009d8;;\u009c", "leftlink"],
  ["left\u001b]unterminated payload", "left"],
  ["left\u001b[", "left"],
  ["left\u001b[2J\u001b[1A\u001b(Bright", "leftright"],
  ["a\u0000\u0007b\r\n\tc\u007f\u0081", "ab   c"],
  ["<script>alert('x')</script> 🐑 中文", "<script>alert('x')</script> 🐑 中文"],
])("treats control/HTML input as inert text: %j", (input, expected) => {
  expect(
    terminalTextSpans(input)
      .map((span) => span.text)
      .join(""),
  ).toBe(expected);
});
