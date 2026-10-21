import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const icons = [
  ["scout-favicon-16", 16, 16, false],
  ["scout-favicon-32", 32, 32, false],
  ["scout-apple-touch", 180, 180, false],
  ["scout-icon-192", 192, 192, false],
  ["scout-icon-512", 512, 512, false],
  ["scout-maskable-512", 512, 512, false],
  ["scout-head", 256, 256, true],
  ["scout-logo", 564, 594, true],
  ["scout-wordmark", 564, 126, true],
] as const;

it.each(icons)(
  "ships %s at its declared size and transparency, small enough to precache",
  (name, width, height, transparent) => {
    const png = readFileSync(`public/icons/${name}.png`);
    expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(png.readUInt32BE(16)).toBe(width);
    expect(png.readUInt32BE(20)).toBe(height);
    expect(png.length).toBeLessThan(2 * 1024 * 1024);
    let alpha = false;
    for (let offset = 8; offset < png.length; ) {
      const size = png.readUInt32BE(offset);
      if (png.toString("ascii", offset + 4, offset + 8) === "tRNS") {
        alpha = png.subarray(offset + 8, offset + 8 + size).some((value) => value < 255);
      }
      offset += size + 12;
    }
    expect(alpha).toBe(transparent);
  },
);

it("links the new favicons and Apple icon instead of the retired horizon artwork", () => {
  const html = readFileSync("index.html", "utf8");
  expect(html).toContain('href="/icons/scout-favicon-16.png"');
  expect(html).toContain('href="/icons/scout-favicon-32.png"');
  expect(html).toContain('href="/icons/scout-apple-touch.png"');
  expect(html).not.toContain("fernblick.svg");
});
