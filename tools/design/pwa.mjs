// Production PWA check: ephemeral loopback server, synthetic dashboard, no Herdr/Pi sockets.
// Uses the separately installed PLAYWRIGHT_MODULE described in tools/design/README.md.
import assert from "node:assert/strict";
import { appendFile, cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { createHttpServer } from "../../dist-server/server/http/server.js";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const directory = await mkdtemp(join(tmpdir(), "fernblick-pwa-"));
const profile = await mkdtemp(join(tmpdir(), "fernblick-pwa-browser-"));
let server;
let browser;
try {
  await cp(resolve("dist"), directory, { recursive: true });
  server = createHttpServer(
    { getDashboard: async () => ({ agents: [], tabs: [], workspaces: [] }) },
    directory,
    {},
  );
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launchPersistentContext(profile, {
    ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}),
    viewport: { width: 390, height: 844 },
    isMobile: true,
    headless: true,
  });
  const context = browser;
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(base);
  await page.getByRole("heading", { name: "Fernblick", exact: true }).waitFor();
  const manifestResponse = await context.request.get(`${base}/manifest.webmanifest`);
  assert.match(manifestResponse.headers()["content-type"], /application\/manifest\+json/);
  const manifest = await manifestResponse.json();
  assert.equal(manifest.id, "/");
  assert.equal(manifest.name, "Fernblick");
  assert.equal(manifest.start_url, "/");
  assert.equal(manifest.scope, "/");
  assert.equal(manifest.display, "standalone");
  assert.ok(manifest.icons.some((icon) => icon.purpose === "maskable"));
  for (const icon of manifest.icons) {
    const response = await context.request.get(base + icon.src);
    assert.equal(response.status(), 200);
    assert.equal(response.headers()["content-type"], "image/png");
    const png = await response.body();
    const [width, height] = icon.sizes.split("x").map(Number);
    assert.equal(png.readUInt32BE(16), width);
    assert.equal(png.readUInt32BE(20), height);
  }
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  const cdp = await context.newCDPSession(page);
  await cdp.send("Page.enable");
  const installability = await cdp.send("Page.getInstallabilityErrors");
  assert.deepEqual(installability.installabilityErrors, []);

  // Use a real application draft to detect unwanted reloads, not a test-only input.
  await page.getByRole("button", { name: "Open create menu", exact: true }).click();
  await page.getByRole("button", { name: /New Workspace/i }).click();
  await page.locator("#new-workspace-label").fill("Unsent workspace draft");
  const other = await context.newPage();
  await other.goto(base);
  await other.waitForFunction(() => !!navigator.serviceWorker.controller);
  await appendFile(join(directory, "sw.js"), "\n// synthetic second release\n");
  await page.evaluate(async () => (await navigator.serviceWorker.ready).update());
  await page.getByRole("button", { name: "Refresh app", exact: true }).waitFor();
  await other.getByRole("button", { name: "Refresh app", exact: true }).waitFor();
  assert.equal(await page.locator("#new-workspace-label").inputValue(), "Unsent workspace draft");

  // A native dialog makes the update notice inert: finish/cancel editing first.
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Later", exact: true }).click();
  assert.equal(await page.getByRole("button", { name: "Refresh app", exact: true }).count(), 0);
  await page.getByRole("button", { name: "Open create menu", exact: true }).click();
  await page.getByRole("button", { name: /New Workspace/i }).click();
  await page.locator("#new-workspace-label").fill("Keep this draft across another window's update");
  await Promise.all([
    other.waitForEvent("load"),
    other.getByRole("button", { name: "Refresh app", exact: true }).click(),
  ]);
  assert.equal(
    await page.locator("#new-workspace-label").inputValue(),
    "Keep this draft across another window's update",
  );
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await mkdir("design-gallery/pwa", { recursive: true });
  await page.screenshot({ path: "design-gallery/pwa/update-phone.png" });
  await Promise.all([
    page.waitForEvent("load"),
    page.getByRole("button", { name: "Refresh app", exact: true }).click(),
  ]);

  await context.setOffline(true);
  // Keep the explicit CDP session's network state aligned with Playwright's sessions.
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", {
    offline: true,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
  });
  await page.reload();
  await page.getByRole("heading", { name: "Fernblick is offline", exact: true }).waitFor();
  assert.equal(await page.getByText("Loading agents…", { exact: true }).count(), 0);
  const apiReachable = await page.evaluate(async () => {
    try {
      await fetch("/api/agents");
      return true;
    } catch {
      return false;
    }
  });
  assert.equal(apiReachable, false, "API responses must never come from the worker cache");
  const cached = await page.evaluate(async () => {
    const requests = await Promise.all(
      (await caches.keys()).map(async (key) => (await caches.open(key)).keys()),
    );
    return requests.flat().map((request) => new URL(request.url).pathname);
  });
  assert.ok(cached.includes("/index.html"));
  for (const path of [
    "/icons/scout-head.png",
    "/icons/scout-logo.png",
    "/icons/scout-wordmark.png",
    ...manifest.icons.map((icon) => icon.src),
  ])
    assert.ok(cached.includes(path), `Branding asset must remain available offline: ${path}`);
  assert.ok(cached.every((path) => !path.startsWith("/api/")));
  await page.screenshot({ path: "design-gallery/pwa/offline-phone.png" });
  await context.setOffline(false);
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
  });
  await page.getByRole("heading", { name: "Fernblick", exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log(
    "PASS: installability, icons, production worker, manual multi-window updates, draft preservation, offline startup, API cache exclusion, reconnect",
  );
} finally {
  await browser?.close();
  if (server?.listening) await new Promise((resolve) => server.close(resolve));
  await rm(directory, { recursive: true, force: true });
  await rm(profile, { recursive: true, force: true });
}
