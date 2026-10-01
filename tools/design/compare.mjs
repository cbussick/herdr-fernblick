// Compare finished application screenshots against a preserved proposal capture.
// Allow only tiny rasterization/animation differences; do not update the reference to hide regressions.
import fs from "node:fs/promises";
import path from "node:path";
const { PNG } = await import(process.env.PNGJS_MODULE || "pngjs");
const { default: pixelmatch } = await import(process.env.PIXELMATCH_MODULE || "pixelmatch");
const reference = process.argv[2];
if (!reference) throw new Error("Usage: node tools/design/compare.mjs /path/to/proposal/after");
const actual = path.resolve("design-gallery/after");
const manifest = JSON.parse(await fs.readFile("design-gallery/after.json", "utf8"));
const results = [];
const allowedRatio = 0.0005;
for (const screen of manifest) {
  const name = `${screen.viewport}-${screen.id}.png`;
  const before = PNG.sync.read(await fs.readFile(path.join(reference, name)));
  const after = PNG.sync.read(await fs.readFile(path.join(actual, name)));
  if (before.width !== after.width || before.height !== after.height)
    throw new Error(`Changed viewport dimensions: ${name}`);
  const changedPixels = pixelmatch(before.data, after.data, null, after.width, after.height, {
    threshold: 0.1,
    includeAA: false,
  });
  const ratio = changedPixels / (after.width * after.height);
  results.push({ name, changedPixels, ratio, passed: ratio <= allowedRatio });
}
const report = {
  reference,
  allowedRatio,
  total: results.length,
  passed: results.filter((result) => result.passed).length,
  results,
};
await fs.writeFile("design-gallery/proposal-comparison.json", JSON.stringify(report, null, 2));
console.log(
  `${report.passed}/${report.total} screenshots match the proposal (maximum allowed difference: ${allowedRatio * 100}%).`,
);
for (const result of results.filter((result) => !result.passed))
  console.error(`${result.name}: ${(result.ratio * 100).toFixed(3)}% changed`);
if (report.passed !== report.total) process.exitCode = 1;
