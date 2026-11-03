// Synthetic fixtures only; no Herdr/Pi socket is used.
// node tools/design/workspace-reorder-touch.mjs http://127.0.0.1:5237
import assert from "node:assert/strict";
import { chromium } from "playwright";

const browser = await chromium.launch();
const failures = [];
try {
  for (const [destination, offset, shouldMove, outsideX] of [
    ["first-header", 20, true],
    ["above-first", -8, true],
    ["above-search", -44, true],
    ["above-header", -80, true],
    ["near-viewport-top", -180, true],
    ["horizontal-exit", -8, false, 1],
  ]) {
    const page = await browser.newPage({
      viewport: { width: 412, height: 923 },
      hasTouch: true,
      isMobile: true,
      serviceWorkers: "block",
    });
    let workspaces = ["Alpha", "Beta", "Gamma"].map((label, i) => ({
      workspace_id: `w${i + 1}`,
      label,
    }));
    const mutations = [];
    await page.route("**/api/**", async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (!path.startsWith("/api/")) return route.continue();
      if (path === "/api/agents")
        return route.fulfill({ json: { agents: [], tabs: [], workspaces } });
      if (path === "/api/workspaces/move" && request.method() === "POST") {
        const body = request.postDataJSON();
        mutations.push(body);
        const moved = workspaces.find((item) => item.workspace_id === body.workspaceId);
        workspaces = workspaces.filter((item) => item !== moved);
        workspaces.splice(
          body.beforeWorkspaceId === null
            ? workspaces.length
            : workspaces.findIndex((item) => item.workspace_id === body.beforeWorkspaceId),
          0,
          moved,
        );
        return route.fulfill({ json: { ok: true } });
      }
      throw new Error(`Unexpected API: ${request.method()} ${path}`);
    });
    await page.goto(process.argv[2] || "http://127.0.0.1:5237");
    const cards = page.getByTestId("workspace-disclosure");
    await cards.first().waitFor();
    const first = await cards.first().boundingBox();
    const source = await page.getByRole("button", { name: "Reorder Gamma" }).boundingBox();
    const cdp = await page.context().newCDPSession(page);
    const send = (type, x, y) =>
      cdp.send("Input.dispatchTouchEvent", {
        type,
        touchPoints: type === "touchEnd" ? [] : [{ x, y }],
      });
    const x = source.x + source.width / 2;
    let startY = source.y + source.height / 2;
    const endY = first.y + offset;
    await send("touchStart", x, startY);
    if (destination === "first-header") {
      const nearHalf = first.y + (first.height * 3) / 4;
      for (let step = 1; step <= 20; step++) {
        await send("touchMove", x, startY + ((nearHalf - startY) * step) / 20);
        await page.waitForTimeout(20);
      }
      await page.evaluate(() => new Promise(requestAnimationFrame));
      assert.equal(
        await page.locator('[data-marker="before"] > details > summary strong').textContent(),
        "Beta",
        "upward drag must not target Alpha before crossing its midpoint",
      );
      startY = nearHalf;
    }
    for (let step = 1; step <= 20; step++) {
      await send(
        "touchMove",
        x + (((outsideX ?? x) - x) * step) / 20,
        startY + ((endY - startY) * step) / 20,
      );
      await page.waitForTimeout(20);
    }
    await page.evaluate(() => new Promise(requestAnimationFrame));
    const marker = await page.locator('[data-marker="before"]').count();
    // A marker in the DOM can still be clipped by the scrolling list.
    const painted = marker
      ? await page.locator('[data-marker="before"]').evaluate((element) => {
          const style = getComputedStyle(element, "::after");
          const rect = element.getBoundingClientRect();
          const top = rect.top + parseFloat(style.top);
          const bottom = top + parseFloat(style.height);
          for (let parent = element.parentElement; parent; parent = parent.parentElement) {
            if (/(auto|scroll|hidden|clip)/.test(getComputedStyle(parent).overflowY)) {
              const clip = parent.getBoundingClientRect();
              if (top < clip.top || bottom > clip.bottom) return false;
            }
          }
          return style.backgroundColor !== "rgba(0, 0, 0, 0)";
        })
      : false;
    if (process.env.REORDER_SCREENSHOTS)
      await page.screenshot({ path: `/tmp/workspace-drop-${destination}.png` });
    await send("touchEnd", 0, 0);
    try {
      if (shouldMove) {
        await page.waitForFunction(
          () =>
            document.querySelector('[data-testid="workspace-disclosure"] > summary strong')
              ?.textContent === "Gamma" &&
            !document.querySelector('[aria-disabled="true"][aria-haspopup="dialog"]'),
          undefined,
          { timeout: 10_000 },
        );
      }
      await page.evaluate(() => new Promise(requestAnimationFrame));
      assert.equal(marker, shouldMove ? 1 : 0, `${destination}: incorrect top insertion indicator`);
      assert.equal(
        painted,
        shouldMove,
        `${destination}: insertion indicator is clipped or unpainted`,
      );
      assert.deepEqual(
        mutations,
        shouldMove ? [{ workspaceId: "w3", beforeWorkspaceId: "w1" }] : [],
      );
      assert.deepEqual(
        await cards.locator(":scope > summary strong").allTextContents(),
        shouldMove ? ["Gamma", "Alpha", "Beta"] : ["Alpha", "Beta", "Gamma"],
      );
      console.log(`${destination}: PASS touch indicator and persisted order`);
    } catch (error) {
      failures.push(`${destination}: ${error.message}`);
      console.error(`${destination}: ${error.message}`);
    }
    await page.close();
  }
  assert.deepEqual(failures, []);
} finally {
  await browser.close();
}
