// Reproduce the approved raster artwork's transparent masters and app exports.
// Install Sharp outside the app: see design/branding/README.md.
import { mkdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const { default: sharp } = await import(process.env.SHARP_MODULE || "sharp");
const root = new URL("../../", import.meta.url);
const path = (name) => fileURLToPath(new URL(name, root));
const background = "#e7f2fc";
const source = await readFile(path("design/branding/scout-light-approved.png"));
const { data, info } = await sharp(source)
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });
if (info.width !== 1254 || info.height !== 1254) throw new Error("Unexpected approved source size");

// Remove only the edge-connected pale-blue background around the mascot.
// Its white wool, pale lens interiors and enclosed pale-blue ear remain opaque.
const { width, height } = info;
const removed = new Uint8Array(width * height);
const queue = new Int32Array(width * height);
let start = 0;
let end = 0;
const backgroundPixel = (pixel) => {
  const i = pixel * 4;
  return Math.hypot(data[i] - 225, data[i + 1] - 240, data[i + 2] - 252) < 12;
};
function visit(pixel) {
  if (removed[pixel] || !backgroundPixel(pixel)) return;
  removed[pixel] = 1;
  queue[end++] = pixel;
}
for (let x = 0; x < width; x++) {
  visit(x);
  visit((height - 1) * width + x);
}
for (let y = 0; y < height; y++) {
  visit(y * width);
  visit(y * width + width - 1);
}
while (start < end) {
  const pixel = queue[start++];
  const x = pixel % width;
  if (x > 0) visit(pixel - 1);
  if (x < width - 1) visit(pixel + 1);
  if (pixel >= width) visit(pixel - width);
  if (pixel < width * (height - 1)) visit(pixel + width);
}
const original = Buffer.from(data);
const matte = [225, 240, 252];
const ink = [23, 55, 79];
function unmatte(pixel, colours) {
  const rgb = original.subarray(pixel * 4, pixel * 4 + 3);
  let best;
  for (const colour of colours) {
    const vector = colour.map((channel, i) => channel - matte[i]);
    const dot = vector.reduce((sum, channel, i) => sum + channel * (rgb[i] - matte[i]), 0);
    const alpha = Math.max(
      0,
      Math.min(1, dot / vector.reduce((sum, channel) => sum + channel ** 2, 0)),
    );
    const error = vector.reduce(
      (sum, channel, i) => sum + (matte[i] + alpha * channel - rgb[i]) ** 2,
      0,
    );
    if (!best || error < best.error) best = { colour, alpha, error };
  }
  const i = pixel * 4;
  if (best.alpha < 0.04) data.fill(0, i, i + 4);
  else {
    data.set(best.colour, i);
    data[i + 3] = Math.round(best.alpha * 255);
  }
}
for (let pixel = 0; pixel < width * height; pixel++) {
  if (pixel >= 905 * width) {
    // Lettering has a single ink colour. Unmatte its edges and enclosed counters
    // instead of retaining a pale-blue fringe on transparent exports.
    unmatte(pixel, [ink]);
  } else {
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    const boundary =
      x > 1 &&
      x < width - 2 &&
      y > 1 &&
      y < height - 2 &&
      [-2, -1, 1, 2, -width, width, -2 * width, 2 * width].some(
        (offset) => removed[pixel + offset] !== removed[pixel],
      );
    if (boundary)
      unmatte(pixel, [
        [254, 254, 254],
        [24, 54, 79],
        [26, 108, 169],
      ]);
    else if (removed[pixel]) data.fill(0, pixel * 4, pixel * 4 + 4);
  }
}
const transparent = await sharp(data, { raw: { width, height, channels: 4 } })
  .png()
  .toBuffer();
const png = { palette: true, colours: 128, dither: 0, effort: 10 };
await mkdir(path("public/icons"), { recursive: true });

// Fixed crops are part of the approved composition, not automatic subject detection.
const head = await sharp(transparent)
  .extract({ left: 230, top: 140, width: 800, height: 760 })
  .extend({ top: 20, bottom: 20, left: 0, right: 0, background: "#0000" })
  .png(png)
  .toBuffer();
const logo = await sharp(transparent)
  .extract({ left: 160, top: 130, width: 940, height: 990 })
  .png(png)
  .toBuffer();
await sharp(head).toFile(path("design/branding/scout-head-master.png"));
await sharp(logo).toFile(path("design/branding/scout-logo-master.png"));
await sharp(head).resize(256, 256).png(png).toFile(path("public/icons/scout-head.png"));
await sharp(logo).resize({ width: 564 }).png(png).toFile(path("public/icons/scout-logo.png"));

async function icon(name, size, artworkFraction) {
  const artworkSize = Math.round(size * artworkFraction);
  const artwork = await sharp(head).resize(artworkSize, artworkSize).png().toBuffer();
  if (name === "scout-maskable-512") {
    const pixels = await sharp(artwork).ensureAlpha().raw().toBuffer();
    for (let y = 0; y < artworkSize; y++)
      for (let x = 0; x < artworkSize; x++)
        if (
          pixels[(y * artworkSize + x) * 4 + 3] &&
          Math.hypot(x - artworkSize / 2, y - artworkSize / 2) > size * 0.4
        )
          throw new Error("Scout extends beyond the maskable safe circle");
  }
  await sharp({ create: { width: size, height: size, channels: 4, background } })
    .composite([{ input: artwork, gravity: "centre" }])
    .removeAlpha()
    .png(png)
    .toFile(path(`public/icons/${name}.png`));
}
await icon("scout-icon-192", 192, 0.88);
await icon("scout-icon-512", 512, 0.88);
// This rounded silhouette fits the central safe circle at 74%; verified above.
await icon("scout-maskable-512", 512, 0.74);
await icon("scout-apple-touch", 180, 0.82);
await icon("scout-favicon-32", 32, 0.94);
await icon("scout-favicon-16", 16, 1);
console.log("Exported Scout masters, transparent UI artwork, solid app icons and favicons.");
