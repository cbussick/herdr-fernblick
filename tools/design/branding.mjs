// Sequential, synthetic browser checks: no real Herdr/Pi sockets or agent commands.
// Run after building; see tools/design/README.md for external Playwright setup.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { createHttpServer } from "../../dist-server/server/http/server.js";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const output = resolve("design-gallery/scout");
await mkdir(output, { recursive: true });
const dashboard = { agents: [], tabs: [], workspaces: [] };
let pending = Promise.resolve(dashboard);
const server = createHttpServer({ getDashboard: () => pending }, resolve("dist"), {});
let browser;
try {
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}),
  });
  for (const [name, viewport] of [
    ["phone", { width: 390, height: 844 }],
    ["tablet", { width: 834, height: 1194 }],
    ["desktop", { width: 1440, height: 1000 }],
  ]) {
    const context = await browser.newContext({
      viewport,
      serviceWorkers: "block",
      reducedMotion: "reduce",
    });
    try {
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      let complete;
      pending = new Promise((done) => {
        complete = done;
      });
      await page.goto(base);
      const loading = page.locator('[data-ui="app-loading"]');
      await loading.waitFor();
      assert.equal(await loading.getAttribute("aria-busy"), "true");
      await loading.locator("img").evaluate((image) => image.decode());
      assert.equal(await loading.locator("img").getAttribute("src"), "/icons/scout-logo.png");
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
      );
      await page.screenshot({ path: `${output}/${name}-loading.png` });
      complete(dashboard);
      await page.getByRole("heading", { name: "Fernblick", exact: true }).waitFor();
      assert.equal(await loading.count(), 0, "No extra splash delay after the dashboard arrives");
      const mark = page.locator('[data-testid="overview-header"] img');
      await mark.evaluate((image) => image.decode());
      assert.equal(await mark.getAttribute("src"), "/icons/scout-head.png");
      assert.equal(await mark.getAttribute("alt"), "");
      assert.equal(Math.round((await mark.boundingBox()).width), 40);
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
      );
      await page.screenshot({ path: `${output}/${name}-overview.png` });
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  }

  const page = await browser.newPage();
  await page.goto(base);
  const assetChecks = await page.evaluate(async () => {
    async function pixels(src) {
      const image = new Image();
      image.src = src;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(image, 0, 0);
      return {
        width: canvas.width,
        height: canvas.height,
        data: ctx.getImageData(0, 0, canvas.width, canvas.height).data,
      };
    }
    const manifest = await (await fetch("/manifest.webmanifest")).json();
    const results = [];
    for (const asset of [...manifest.icons, { src: "/icons/scout-apple-touch.png" }]) {
      const { data, width, height } = await pixels(asset.src);
      let opaque = true;
      let withinSafeCircle = true;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const i = (y * width + x) * 4;
          opaque &&= data[i + 3] === 255;
          if (
            asset.purpose === "maskable" &&
            Math.hypot(x - width / 2, y - height / 2) > width * 0.4
          )
            withinSafeCircle &&= data[i] === 231 && data[i + 1] === 242 && data[i + 2] === 252;
        }
      }
      results.push({ src: asset.src, opaque, withinSafeCircle, width, height });
    }
    for (const src of ["/icons/scout-head.png", "/icons/scout-logo.png"]) {
      const { data, width, height } = await pixels(src);
      const corners = [0, width - 1, (height - 1) * width, width * height - 1];
      results.push({
        src,
        transparentCorners: corners.every((pixel) => data[pixel * 4 + 3] === 0),
      });
    }
    return { results, manifest };
  });
  assert.equal(assetChecks.manifest.id, "/");
  assert.equal(assetChecks.manifest.background_color, "#e7f2fc");
  const maskable = assetChecks.manifest.icons.find((icon) => icon.purpose === "maskable");
  assert.equal(maskable.src, "/icons/scout-maskable-512.png");
  for (const result of assetChecks.results) {
    if ("opaque" in result) {
      assert.equal(result.opaque, true, result.src);
      assert.equal(result.withinSafeCircle, true, result.src);
    } else assert.equal(result.transparentCorners, true, result.src);
  }
  await page.close();
  console.log(
    "PASS: Scout loading/overview at three viewports; no extra delay; transparent UI artwork; opaque icons; maskable safe circle; unchanged PWA identity.",
  );
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise((done) => server.close(done));
}
