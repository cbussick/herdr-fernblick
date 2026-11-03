// Synthetic fixtures only; never connects to Herdr/Pi.
// node tools/design/workspace-reorder-centers.mjs http://127.0.0.1:5243
import assert from "node:assert/strict";
import { chromium } from "playwright";

const browser = await chromium.launch();
const failures = [];
try {
  for (const direction of ["down", "up"]) {
    for (const [grabOffset, expanded] of [
      [6, false],
      [38, false],
      [6, true],
      [38, true],
    ]) {
      const name = `${direction}, grab ${grabOffset}px, ${expanded ? "expanded" : "collapsed"}`;
      const page = await browser.newPage({
        viewport: { width: 412, height: 923 },
        hasTouch: true,
        isMobile: true,
        serviceWorkers: "block",
        reducedMotion: "reduce",
      });
      page.setDefaultTimeout(10_000);
      try {
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
        await page.goto(process.argv[2] || "http://127.0.0.1:5243");
        const cards = page.getByTestId("workspace-disclosure");
        await cards.first().waitFor();
        const sourceLabel = direction === "down" ? "Alpha" : "Gamma";
        if (expanded) {
          await cards
            .nth(direction === "down" ? 0 : 2)
            .locator(":scope > summary")
            .click();
          await cards.nth(1).locator(":scope > summary").click();
        }
        const handle = await page
          .getByRole("button", { name: `Reorder ${sourceLabel}` })
          .boundingBox();
        const target = await cards.nth(1).boundingBox();
        const midpoint = target.y + target.height / 2;
        const sign = direction === "down" ? 1 : -1;
        const cdp = await page.context().newCDPSession(page);
        const x = handle.x + handle.width / 2;
        let pointerY = handle.y + grabOffset;
        const send = (type) =>
          cdp.send("Input.dispatchTouchEvent", {
            type,
            touchPoints: type === "touchEnd" ? [] : [{ x, y: pointerY }],
          });
        await send("touchStart");
        pointerY += sign * 8;
        await send("touchMove");
        const preview = page.getByTestId("workspace-drag-preview");
        await preview.waitFor();
        await page.evaluate(
          () =>
            new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
        );
        const moveCenter = async (desired) => {
          const rect = await preview.boundingBox();
          const start = pointerY;
          const delta = desired - rect.y - rect.height / 2;
          for (let step = 1; step <= 15; step++) {
            pointerY = start + (delta * step) / 15;
            await send("touchMove");
            await page.waitForTimeout(16);
          }
          // Overlay measurement can settle after the activation event.
          for (let attempt = 0; attempt < 3; attempt++) {
            await page.evaluate(() => new Promise(requestAnimationFrame));
            const measured = await preview.boundingBox();
            const error = desired - measured.y - measured.height / 2;
            if (Math.abs(error) <= 0.5) break;
            pointerY += error;
            await send("touchMove");
            await page.waitForTimeout(16);
          }
          const actual = await preview.boundingBox();
          assert.ok(
            Math.abs(actual.y + actual.height / 2 - desired) <= 0.5,
            `${name}: preview center ${actual.y + actual.height / 2}, requested ${desired}`,
          );
        };
        // Assert against the visible preview, not the finger or original card.
        await moveCenter(midpoint - sign);
        assert.equal(
          await page.locator("[data-marker]").count(),
          0,
          `${name}: indicator appeared before the dragged center crossed the target center`,
        );
        await moveCenter(midpoint + sign);
        const marker = page.locator(`[data-marker="${direction === "down" ? "after" : "before"}"]`);
        assert.equal(
          await marker.locator("details > summary strong").textContent(),
          "Beta",
          `${name}: missing indicator after the centers crossed`,
        );
        await moveCenter(midpoint - sign);
        assert.equal(
          await page.locator("[data-marker]").count(),
          0,
          `${name}: moving the center back must remove the indicator`,
        );
        await moveCenter(midpoint + sign);
        if (process.env.REORDER_SCREENSHOTS)
          await page.screenshot({ path: `/tmp/workspace-center-${direction}-${grabOffset}.png` });
        await send("touchEnd");
        await page.waitForFunction(
          () =>
            !document.querySelector('[data-testid="workspace-drag-preview"]') &&
            !document.querySelector('[aria-disabled="true"][aria-haspopup="dialog"]'),
        );
        assert.deepEqual(mutations, [
          {
            workspaceId: direction === "down" ? "w1" : "w3",
            beforeWorkspaceId: direction === "down" ? "w3" : "w2",
          },
        ]);
        assert.deepEqual(
          await cards.locator(":scope > summary strong").allTextContents(),
          direction === "down" ? ["Beta", "Alpha", "Gamma"] : ["Alpha", "Gamma", "Beta"],
        );
        console.log(`${name}: PASS center crossing, reversal, indicator and saved order`);
      } catch (error) {
        failures.push(`${name}: ${error.message}`);
        console.error(`${name}: ${error.message}`);
      } finally {
        await page.close();
      }
    }
  }
  assert.deepEqual(failures, []);
} finally {
  await browser.close();
}
