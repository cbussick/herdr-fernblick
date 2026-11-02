// Synthetic fixtures only; no Herdr/Pi socket is used.
// node tools/design/workspace-reorder-touch.mjs http://127.0.0.1:5237
import assert from "node:assert/strict";
import { chromium } from "playwright";

const browser = await chromium.launch();
try {
  for (const [destination, offset, shouldMove] of [
    ["first-header", 20, true],
    ["above-first", -8, true],
    ["edge-limit", -44, true],
    ["outside-list", -60, false],
  ]) {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
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
    const startY = source.y + source.height / 2;
    const endY = first.y + offset;
    await send("touchStart", x, startY);
    for (let step = 1; step <= 20; step++) {
      await send("touchMove", x, startY + ((endY - startY) * step) / 20);
      await page.waitForTimeout(20);
    }
    const marker = await page.locator('[data-marker="before"]').count();
    await send("touchEnd", 0, 0);
    await page.waitForTimeout(300);
    assert.equal(marker, shouldMove ? 1 : 0, `${destination}: incorrect top insertion indicator`);
    assert.deepEqual(mutations, shouldMove ? [{ workspaceId: "w3", beforeWorkspaceId: "w1" }] : []);
    assert.deepEqual(
      await cards.locator(":scope > summary strong").allTextContents(),
      shouldMove ? ["Gamma", "Alpha", "Beta"] : ["Alpha", "Beta", "Gamma"],
    );
    console.log(`${destination}: PASS touch indicator and persisted order`);
    await page.close();
  }
} finally {
  await browser.close();
}
