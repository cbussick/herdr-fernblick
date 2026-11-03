import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const tokens = readFileSync(new URL("../../styles/tokens.module.css", import.meta.url), "utf8");
const message = readFileSync(new URL("./ChatMessageText.module.css", import.meta.url), "utf8");
const syntax = readFileSync(new URL("./ChatCodeText.module.css", import.meta.url), "utf8");

function luminance(hex: string) {
  const expanded = hex.length === 3 ? [...hex].map((digit) => digit.repeat(2)).join("") : hex;
  const channels = expanded.match(/../g)!.map((channel) => {
    const value = parseInt(channel, 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

describe("white code block palette", () => {
  it("uses the white surface for code and retains the subtle toolbar", () => {
    expect(tokens).toMatch(/--color-surface:\s*#fff;/);
    expect(message).toMatch(/\.code-block\s*\{[^}]*background: var\(--color-surface\);/);
    expect(message).toMatch(/\.code-toolbar\s*\{[^}]*background: var\(--color-surface-subtle\);/);
  });

  it("keeps every syntax color and default code text above WCAG AA contrast on white", () => {
    const colors = [...syntax.matchAll(/color:\s*#([a-f\d]{6});/g)].map((match) => match[1]);
    const defaultColor = /\.code-block\s*\{[^}]*color:\s*#([a-f\d]{6});/.exec(message)?.[1];
    expect(colors).toHaveLength(6);
    expect(defaultColor).toBeDefined();
    for (const color of [...colors, defaultColor!]) {
      const contrast = (luminance("ffffff") + 0.05) / (luminance(color) + 0.05);
      expect(contrast, `#${color} against white`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
