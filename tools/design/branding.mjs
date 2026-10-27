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
let unavailable = false;
const server = createHttpServer(
  {
    getDashboard: () => {
      if (unavailable) throw new Error("Synthetic connection failure");
      return pending;
    },
  },
  resolve("dist"),
  {},
);
let browser;
try {
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}),
  });
  for (const [name, viewport] of [
    ["small-phone", { width: 320, height: 568 }],
    ["phone", { width: 390, height: 844 }],
    ["tablet", { width: 834, height: 1194 }],
    ["narrow-sidebar", { width: 900, height: 800 }],
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
      const logo = loading.getByRole("img", { name: "Fernblick", exact: true });
      assert.equal(await logo.getAttribute("data-animated"), "true");
      assert.equal(await loading.locator("img, image").count(), 0, "Loading logo is fully vector");
      assert.equal(
        await loading.evaluate((element) => element.getAnimations({ subtree: true }).length),
        0,
      );
      await page.emulateMedia({ reducedMotion: "no-preference" });
      const motion = await loading.evaluate((element) => {
        const animations = element.getAnimations({ subtree: true });
        const eyes = animations.find(
          (animation) => animation.effect.target.getAttribute("data-part") === "pupils",
        );
        const label = animations.find((animation) => animation.effect.target.tagName === "P");
        if (!eyes || !label) throw new Error("Loading animations missing");
        eyes.pause();
        label.pause();
        const poses = [0, 3200, 4400, 5200, 6400, 7999].map((time) => {
          eyes.currentTime = time;
          return new DOMMatrix(getComputedStyle(eyes.effect.target).transform).m41;
        });
        label.currentTime = 1600;
        const dimmed = Number(getComputedStyle(label.effect.target).opacity);
        label.currentTime = 0;
        return {
          poses,
          dimmed,
          bright: Number(getComputedStyle(label.effect.target).opacity),
          eyeDuration: eyes.effect.getTiming().duration,
        };
      });
      assert.equal(motion.eyeDuration, 8000);
      assert.deepEqual(
        motion.poses.map((x) => Math.round(x)),
        [0, 0, -133, -133, 0, 0],
      );
      assert.ok(Math.abs(motion.dimmed - 0.6) < 0.01);
      assert.equal(motion.bright, 1);
      await page.emulateMedia({ reducedMotion: "reduce" });
      assert.equal(
        await loading.evaluate((element) => element.getAnimations({ subtree: true }).length),
        0,
      );
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
      );
      await page.screenshot({ path: `${output}/${name}-loading.png` });
      complete(dashboard);
      await page.getByRole("heading", { name: "Fernblick", exact: true }).waitFor();
      await page.evaluate(() => document.fonts.ready);
      assert.equal(await loading.count(), 0, "No extra splash delay after the dashboard arrives");
      const mark = page.locator('[data-testid="overview-header"] img[src="/icons/scout-head.svg"]');
      await mark.evaluate((image) => image.decode());
      assert.equal(await mark.getAttribute("src"), "/icons/scout-head.svg");
      assert.equal(await mark.getAttribute("alt"), "");
      assert.equal(Math.round((await mark.boundingBox()).width), 40);
      const heading = page.getByRole("heading", { name: "Fernblick", exact: true });
      assert.equal(await heading.count(), 1);
      const wordmark = heading.locator("img");
      await wordmark.evaluate((image) => image.decode());
      assert.equal(await wordmark.getAttribute("src"), "/icons/scout-wordmark.svg");
      assert.equal(await wordmark.getAttribute("aria-hidden"), "true");
      const textBounds = await wordmark.boundingBox();
      const headBounds = await mark.boundingBox();
      const statusBounds = await page.getByText("Connected", { exact: true }).boundingBox();
      const header = page.getByTestId("overview-header");
      const headerBounds = await header.boundingBox();
      const rightPadding = await header.evaluate((element) =>
        parseFloat(getComputedStyle(element).paddingRight),
      );
      assert.ok(
        statusBounds.x + statusBounds.width <=
          headerBounds.x + headerBounds.width - rightPadding + 1,
        "Connection status must stay inside the padded header",
      );
      // The settings button leaves 80px at 320px and 48px in the 288px sidebar.
      // Verify the SVG preserves the PNG layout rather than changing the header.
      const rasterWidth = await wordmark.evaluate(async (image) => {
        const vectorSrc = image.src;
        image.src = "/icons/scout-wordmark.png";
        await image.decode();
        const width = image.getBoundingClientRect().width;
        image.src = vectorSrc;
        await image.decode();
        return width;
      });
      assert.equal(textBounds.width, rasterWidth, "Vector wordmark preserves raster layout");
      const minimumWidth = name === "narrow-sidebar" ? 48 : 80;
      assert.ok(textBounds.width >= minimumWidth && textBounds.width <= 128);
      assert.ok(headBounds.x + headBounds.width <= textBounds.x - 6);
      assert.ok(
        textBounds.x + textBounds.width <= statusBounds.x - 6,
        "Wordmark must not overlap connection status",
      );
      assert.ok(
        Math.abs(textBounds.width / textBounds.height - 564 / 126) < 0.01,
        "Keep the lettering proportions",
      );
      await page.evaluate(() => document.fonts.ready);
      assert.match(
        await page
          .getByRole("tab", { name: "Workspaces", exact: true })
          .evaluate((element) => getComputedStyle(element).fontFamily),
        /Manrope/,
      );
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
      );
      await page.screenshot({ path: `${output}/${name}-overview.png` });
      const connection = page.getByTestId("connection-status");
      assert.equal(await connection.getAttribute("role"), "status");
      assert.equal(await connection.locator("svg").getAttribute("aria-hidden"), "true");
      assert.equal(await connection.locator("i").count(), 0);
      const connectedShape = await connection.locator("svg").innerHTML();
      const connectedColor = await connection.evaluate(
        (element) => getComputedStyle(element).color,
      );

      await context.setOffline(true);
      await page.getByText("Disconnected", { exact: true }).waitFor();
      assert.notEqual(await connection.locator("svg").innerHTML(), connectedShape);
      assert.notEqual(
        await connection.evaluate((element) => getComputedStyle(element).color),
        connectedColor,
      );
      const disconnectedBounds = await connection.boundingBox();
      const disconnectedWordmark = await wordmark.boundingBox();
      assert.ok(disconnectedWordmark.x + disconnectedWordmark.width <= disconnectedBounds.x - 6);
      assert.ok(
        disconnectedBounds.x + disconnectedBounds.width <=
          headerBounds.x + headerBounds.width - rightPadding + 1,
        "Disconnected status must stay inside the padded header",
      );
      assert.equal(await page.getByTestId("agent-list").count(), 1);
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
      );
      await page.screenshot({ path: `${output}/${name}-disconnected.png` });
      await context.setOffline(false);
      await page.getByText("Connected", { exact: true }).waitFor();

      unavailable = true;
      await page.getByText("Disconnected", { exact: true }).waitFor();
      assert.equal(await page.getByTestId("agent-list").count(), 1);
      assert.equal(await page.getByTestId("page-state").count(), 0);
      unavailable = false;
      await page.getByText("Connected", { exact: true }).waitFor();
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
    for (const src of [
      "/icons/scout-head.svg",
      "/icons/scout-logo.svg",
      "/icons/scout-wordmark.svg",
    ]) {
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
    "PASS: Scout loading/header and plug/unplug connection states at five viewports; offline and failed-poll recovery; accessible wordmark without overlap; Manrope UI unchanged; transparent artwork; opaque icons; maskable safe circle; unchanged PWA identity.",
  );
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise((done) => server.close(done));
}
