// Real production worker + synthetic dashboard. No live agents or private data.
// Run after npm run build: node tools/design/settings.mjs
import assert from "node:assert/strict";
import { appendFile, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createHttpServer } from "../../dist-server/server/http/server.js";
const { chromium, webkit } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const running = JSON.parse(await readFile("dist/version.json", "utf8"));
await mkdir("design-gallery/settings", { recursive: true });
for (const [name, engine] of [
  ["chromium", chromium],
  ["webkit", webkit],
]) {
  const directory = await mkdtemp(join(tmpdir(), "fernblick-settings-"));
  const server = createHttpServer(
    { getDashboard: async () => ({ agents: [], tabs: [], workspaces: [] }) },
    directory,
    {},
  );
  let browser;
  try {
    await cp(resolve("dist"), directory, { recursive: true });
    await new Promise((done) => server.listen(0, "127.0.0.1", done));
    browser = await engine.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 834, height: 1194 }, hasTouch: true });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (text) => {
            window.copiedDiagnostics = text;
          },
        },
      });
    });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
    const gear = page.getByRole("button", { name: "Open settings", exact: true });
    const modal = page.getByRole("dialog", { name: "Settings", exact: true });
    for (const [label, width, height] of [
      ["small-phone", 320, 568],
      ["ipad", 834, 1194],
      ["ipad-landscape", 1194, 834],
      ["desktop", 1440, 1000],
    ]) {
      await page.setViewportSize({ width, height });
      const target = await gear.boundingBox();
      assert.ok(target.width >= 44 && target.height >= 44);
      assert.ok(
        await gear.evaluate((node) => {
          const r = node.getBoundingClientRect();
          return (
            r.left >= 0 &&
            r.right <= innerWidth &&
            node.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2))
          );
        }),
        "Settings gear must remain visible and touchable",
      );
      await gear.focus();
      await page.keyboard.press("Enter");
      await modal.waitFor();
      assert.equal(
        await modal
          .getByText(
            "The running build identifies the app loaded on this device, even when it is cached.",
            { exact: true },
          )
          .count(),
        0,
      );
      assert.equal(
        await modal
          .getByText("Check which build is available from the server.", { exact: true })
          .count(),
        0,
      );
      const copy = modal.getByRole("button", { name: "Copy diagnostics", exact: true });
      const view = modal.getByRole("button", { name: "View diagnostics", exact: true });
      const copyBounds = await copy.boundingBox();
      const viewBounds = await view.boundingBox();
      assert.ok(Math.abs(copyBounds.y - viewBounds.y) < 1, "Copy and View must share one row");
      assert.ok(viewBounds.x >= copyBounds.x + copyBounds.width, "View follows Copy");
      assert.ok(viewBounds.width >= 44 && viewBounds.height >= 44, "View stays touch-sized");
      const diagnosticText = modal.locator('pre[aria-label="Diagnostics"]');
      assert.equal(await view.getAttribute("aria-expanded"), "false");
      assert.equal(await diagnosticText.isVisible(), false);
      assert.equal(
        await view.getAttribute("aria-controls"),
        await diagnosticText.getAttribute("id"),
      );
      await view.focus();
      await page.keyboard.press("Enter");
      assert.equal(await view.getAttribute("aria-expanded"), "true");
      assert.equal(await diagnosticText.isVisible(), true);
      await page.keyboard.press("Space");
      assert.equal(await view.getAttribute("aria-expanded"), "false");
      assert.equal(await diagnosticText.isVisible(), false);
      assert.equal(
        await modal.getByTestId("running-build").locator("code").getAttribute("title"),
        running.revision,
      );
      assert.equal(
        await modal.getByTestId("running-build").locator("time").getAttribute("datetime"),
        running.builtAt,
      );
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
      );
      assert.equal(await modal.evaluate((node) => node.scrollWidth > node.clientWidth), false);
      await page.evaluate(() => document.fonts.ready);
      const beforeCheck = await modal.boundingBox();
      const beforeCopy = await copy.boundingBox();
      let releaseCheck;
      const checkGate = new Promise((resolve) => {
        releaseCheck = resolve;
      });
      const delayMetadata = async (route) => {
        await checkGate;
        await route.continue();
      };
      await page.route("**/version.json", delayMetadata);
      await modal.getByRole("button", { name: "Check for updates", exact: true }).click();
      await modal.getByRole("button", { name: "Checking…", exact: true }).waitFor();
      const whileChecking = await modal.boundingBox();
      assert.ok(
        Math.abs(beforeCheck.y - whileChecking.y) < 1 &&
          Math.abs(beforeCheck.height - whileChecking.height) < 1,
        "Checking progress must not shift the dialog",
      );
      releaseCheck();
      await modal.getByText("Up to date.", { exact: true }).waitFor();
      await page.unroute("**/version.json", delayMetadata);
      const afterCheck = await modal.boundingBox();
      assert.ok(
        Math.abs(beforeCheck.y - afterCheck.y) < 1 &&
          Math.abs(beforeCheck.height - afterCheck.height) < 1,
        "Checking and its confirmation must not shift the dialog",
      );
      assert.ok(
        Math.abs(beforeCopy.y - (await copy.boundingBox()).y) < 1,
        "Update feedback must not move diagnostics actions",
      );
      const snackbar = modal.getByTestId("snackbar");
      await snackbar.getByRole("status").getByText("Up to date.", { exact: true }).waitFor();
      assert.equal(await snackbar.evaluate((node) => node.contains(document.activeElement)), false);
      const dismiss = snackbar.getByRole("button", { name: "Dismiss notification", exact: true });
      assert.ok(
        await dismiss.evaluate((node) => {
          const r = node.getBoundingClientRect();
          return node.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
        }),
        "Snackbar must be clickable above the native dialog backdrop",
      );
      await dismiss.click();
      assert.equal(await snackbar.count(), 0);
      assert.ok(
        Math.abs(beforeCheck.y - (await modal.boundingBox()).y) < 1,
        "Dismissing confirmation must not shift the dialog",
      );
      assert.equal(
        await modal.getByTestId("latest-build").locator("code").getAttribute("title"),
        running.revision,
      );
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      );
      await page.screenshot({ path: `design-gallery/settings/${name}-${label}.png` });
      await page.keyboard.press("Escape");
      await modal.waitFor({ state: "hidden" });
      assert.equal(await gear.evaluate((node) => node === document.activeElement), true);
    }
    await gear.click();
    const beforeCopied = await modal.boundingBox();
    await modal.getByRole("button", { name: "Copy diagnostics", exact: true }).click();
    await modal.getByText("Diagnostics copied.", { exact: true }).waitFor();
    const afterCopied = await modal.boundingBox();
    await page.screenshot({ path: `design-gallery/settings/${name}-copied-snackbar.png` });
    assert.ok(
      Math.abs(beforeCopied.y - afterCopied.y) < 1 &&
        Math.abs(beforeCopied.height - afterCopied.height) < 1,
      "Copy confirmation must not shift the dialog",
    );
    await modal.getByTestId("snackbar").getByText("Diagnostics copied.", { exact: true }).waitFor();
    const copied = await page.evaluate(() => JSON.parse(window.copiedDiagnostics));
    assert.deepEqual(copied.runningBuild, running);
    assert.deepEqual(copied.latestAvailableBuild, running);
    assert.equal(copied.serviceWorker.controlled, true);
    assert.equal(copied.safeAreaTop, "0px");
    assert.deepEqual(
      Object.keys(copied).sort(),
      [
        "app",
        "runningBuild",
        "latestAvailableBuild",
        "updateStatus",
        "updateError",
        "online",
        "secureContext",
        "displayMode",
        "serviceWorker",
        "viewport",
        "safeAreaTop",
        "userAgent",
      ].sort(),
    );
    await page.evaluate(() => {
      navigator.clipboard.writeText = async () => {
        throw new Error("Clipboard blocked");
      };
    });
    await modal.getByRole("button", { name: "Copy diagnostics", exact: true }).click();
    await modal.getByText(/Copy failed/).waitFor();
    await modal.getByRole("button", { name: "View diagnostics", exact: true }).click();
    assert.ok(
      (await modal.locator('pre[aria-label="Diagnostics"]').innerText()).includes(running.revision),
    );
    await modal.getByRole("button", { name: "View diagnostics", exact: true }).click();

    await writeFile(join(directory, "version.json"), "not valid JSON");
    await modal.getByRole("button", { name: "Check for updates", exact: true }).click();
    await modal.getByText(/Check failed/).waitFor();
    assert.equal(
      await modal.getByTestId("running-build").locator("code").getAttribute("title"),
      running.revision,
    );
    assert.equal(
      await modal.getByTestId("latest-build").locator("code").getAttribute("title"),
      running.revision,
    );

    const next = { revision: "b".repeat(40), builtAt: "2026-10-25T12:00:00.000Z" };
    await writeFile(join(directory, "version.json"), JSON.stringify(next));
    await appendFile(join(directory, "sw.js"), "\n// Synthetic next release\n");
    await modal.getByRole("button", { name: "Check for updates", exact: true }).click();
    await modal.getByText("Update ready.", { exact: true }).waitFor();
    assert.equal(
      await modal.getByTestId("running-build").locator("code").getAttribute("title"),
      running.revision,
    );
    assert.equal(
      await modal.getByTestId("latest-build").locator("code").getAttribute("title"),
      next.revision,
    );
    assert.equal(
      await modal.getByRole("button", { name: "Refresh app", exact: true }).isVisible(),
      true,
    );
    const cached = await page.evaluate(async () => {
      const requests = await Promise.all(
        (await caches.keys()).map(async (key) => (await caches.open(key)).keys()),
      );
      return requests.flat().map((request) => new URL(request.url).pathname);
    });
    assert.ok(!cached.includes("/version.json"), "Latest build metadata must never be precached");
    await modal.getByRole("button", { name: "Close settings", exact: true }).click();
    const notice = page.getByRole("complementary", { name: "App status" });
    await notice.getByRole("button", { name: "Later", exact: true }).click();
    await gear.click();
    await modal.getByRole("button", { name: "Check for updates", exact: true }).click();
    await modal.getByText("Update ready.", { exact: true }).waitFor();
    await Promise.all([
      page.waitForEvent("load"),
      modal.getByRole("button", { name: "Refresh app", exact: true }).click(),
    ]);
    assert.deepEqual(errors, []);
    console.log(
      `${name}: PASS running/latest identities, network metadata, manual worker update, retry/Later, explicit refresh, copy/privacy, modal focus, responsive layout`,
    );
  } finally {
    await browser?.close();
    await new Promise((done) => server.close(done));
    await rm(directory, { recursive: true, force: true });
  }
}
