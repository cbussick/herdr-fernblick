// Preparation-only raster check for internal gaps in the generated SVG.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const sharp = require(process.env.SHARP_MODULE || "sharp");
const { data, info } = await sharp(
  new URL("../../public/icons/scout-logo.svg", import.meta.url).pathname,
)
  .resize(1128, 1188)
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });
// This interior rectangle spans the upper goggles, eye openings and navy face.
// None of it meets the logo's exterior: any transparency here is a tracing seam.
let gaps = 0;
for (let y = 360; y < 660; y++) {
  for (let x = 360; x < 820; x++) {
    if (data[(y * info.width + x) * 4 + 3] < 250) gaps++;
  }
}
assert.equal(gaps, 0, `Found ${gaps} translucent pixels inside the goggles`);
console.log("No internal gaps in the goggles at 2× resolution.");

const closeup = await sharp(new URL("../../public/icons/scout-logo.svg", import.meta.url).pathname)
  .resize(2256, 2376)
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });
// At the right-facing pose these patches contain only navy pupil and blue
// goggles. Their antialiased boundary must not pick up the white eye backing.
let palePixels = 0;
for (const left of [280, 468]) {
  for (let y = 272 * 4; y < 288 * 4; y++) {
    for (let x = left * 4; x < (left + 10) * 4; x++) {
      if (closeup.data[(y * closeup.info.width + x) * 4] > 30) palePixels++;
    }
  }
}
assert.equal(palePixels, 0, `Found ${palePixels} pale pixels at pupil/goggle boundaries`);
console.log("No white fringe at pupil/goggle boundaries at 4× resolution.");
