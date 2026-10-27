// Synthetic fixtures only; never connects to a Herdr/Pi socket.
// node tools/design/workspace-reorder.mjs http://127.0.0.1:5218
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
const { chromium, webkit } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.argv[2] || "http://127.0.0.1:5218";
await mkdir("design-gallery/workspace-reorder", { recursive: true });
for (const [name, engine, mobile] of [
  ["chromium", chromium, false],
  ["webkit", webkit, false],
  ["touch", chromium, true],
]) {
  if (process.env.REORDER_ENGINE && process.env.REORDER_ENGINE !== name) continue;
  const browser = await engine.launch();
  try {
    const page = await browser.newPage({
      viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 },
      hasTouch: mobile,
      isMobile: mobile,
      serviceWorkers: "block",
      reducedMotion: "reduce",
    });
    const errors = [];
    const mutations = [];
    let fail = false;
    let workspaces = ["Alpha", "Beta", "Gamma"].map((label, i) => ({
      workspace_id: `w${i + 1}`,
      label,
    }));
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/api/**", async (route) => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      if (!pathname.startsWith("/api/")) return route.continue();
      if (pathname === "/api/agents" && request.method() === "GET")
        return route.fulfill({ json: { agents: [], tabs: [], workspaces } });
      if (pathname === "/api/workspaces/move" && request.method() === "POST") {
        const body = request.postDataJSON();
        mutations.push(body);
        await new Promise((resolve) => setTimeout(resolve, 150));
        if (fail) return route.fulfill({ status: 502, json: { error: "Synthetic Herdr failure" } });
        const moved = workspaces.find((w) => w.workspace_id === body.workspaceId);
        workspaces = workspaces.filter((w) => w !== moved);
        const index =
          body.beforeWorkspaceId === null
            ? workspaces.length
            : workspaces.findIndex((w) => w.workspace_id === body.beforeWorkspaceId);
        workspaces.splice(index, 0, moved);
        return route.fulfill({ json: { ok: true } });
      }
      errors.push(`Unexpected API: ${request.method()} ${pathname}`);
      return route.fulfill({ status: 500, json: { error: "Unexpected API" } });
    });
    await page.goto(base);
    const cards = page.getByTestId("workspace-disclosure");
    const header = (label) =>
      cards
        .filter({ has: page.locator("summary strong", { hasText: label }) })
        .locator(":scope > summary");
    const handle = (label) => page.getByRole("button", { name: `Reorder ${label}`, exact: true });
    const order = () => cards.locator(":scope > summary strong").allTextContents();
    const waitOrder = async (expected) => {
      await page.waitForFunction(
        (expected) =>
          JSON.stringify(
            [
              ...document.querySelectorAll('[data-testid="workspace-disclosure"] > summary strong'),
            ].map((el) => el.textContent),
          ) === JSON.stringify(expected),
        expected,
      );
    };
    await cards.first().waitFor();
    await header("Alpha").click();
    assert.notEqual(await cards.first().getAttribute("open"), null);
    const a = await handle("Alpha").boundingBox();
    const c = await header("Gamma").boundingBox();
    if (mobile) {
      assert.equal(await handle("Alpha").evaluate((el) => getComputedStyle(el).opacity), "1");
      assert.equal(a.width, 44);
      const cdp = await page.context().newCDPSession(page);
      const send = (type, x, y) =>
        cdp.send("Input.dispatchTouchEvent", {
          type,
          touchPoints: type === "touchEnd" ? [] : [{ x, y }],
        });
      await send("touchStart", a.x + a.width / 2, a.y + a.height / 2);
      for (let i = 1; i <= 15; i++) {
        await send(
          "touchMove",
          a.x + a.width / 2,
          a.y + a.height / 2 + ((c.y + c.height / 2 - a.y - a.height / 2) * i) / 15,
        );
        await page.waitForTimeout(20);
      }
      await send("touchEnd", 0, 0);
    } else {
      await handle("Alpha").hover();
      await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
      await page.mouse.down();
      await page.mouse.move(a.x + a.width / 2, c.y + c.height / 2, { steps: 15 });
      await page.locator('[data-marker="after"]').waitFor();
      await page.screenshot({ path: `design-gallery/workspace-reorder/${name}-drag.png` });
      await page.mouse.up();
    }
    await waitOrder(["Beta", "Gamma", "Alpha"]);
    await page.waitForFunction(
      () => !document.querySelector('[aria-disabled="true"][aria-haspopup="dialog"]'),
    );
    assert.deepEqual(mutations, [{ workspaceId: "w1", beforeWorkspaceId: null }]);
    assert.notEqual(
      await cards.last().getAttribute("open"),
      null,
      "expanded state follows workspace identity",
    );
    // Click-only alternative, Escape, focus restoration and no disclosure toggle.
    await handle("Gamma").click();
    const dialog = page.getByRole("dialog", { name: "Move workspace" });
    await dialog.waitFor();
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });
    assert.equal(await handle("Gamma").evaluate((el) => document.activeElement === el), true);
    assert.equal(await cards.nth(1).getAttribute("open"), null);
    await handle("Gamma").click();
    await dialog.getByLabel("Move before").selectOption("w2");
    await dialog.getByRole("button", { name: "Move", exact: true }).click();
    await waitOrder(["Gamma", "Beta", "Alpha"]);
    await page.waitForFunction(
      () => !document.querySelector('[aria-disabled="true"][aria-haspopup="dialog"]'),
    );
    assert.equal(await handle("Gamma").evaluate((el) => document.activeElement === el), true);
    // Keyboard reorder and cancellation.
    await handle("Gamma").focus();
    await page.keyboard.press("Space");
    await page.locator('[data-dragging="true"]').waitFor();
    await page.keyboard.press("ArrowDown");
    await page.locator('[data-marker="after"]').waitFor();
    await page.keyboard.press("Escape");
    assert.deepEqual(await order(), ["Gamma", "Beta", "Alpha"]);
    assert.equal(mutations.length, 2);
    // Dnd-kit restores activator focus on the next animation frame after cancellation.
    await page.waitForTimeout(100);
    await handle("Gamma").focus();
    await page.keyboard.press("Space");
    await page.locator('[data-dragging="true"]').waitFor();
    await page.keyboard.press("ArrowDown");
    await page.locator('[data-marker="after"]').waitFor();
    await page.keyboard.press("Space");
    await waitOrder(["Beta", "Gamma", "Alpha"]);
    await page.waitForFunction(
      () => !document.querySelector('[aria-disabled="true"][aria-haspopup="dialog"]'),
    );
    // Errors roll back the optimistic move and remain actionable.
    fail = true;
    await handle("Alpha").click();
    await dialog.getByLabel("Move before").selectOption("w2");
    await dialog.getByRole("button", { name: "Move", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "Synthetic Herdr failure" }).waitFor();
    await waitOrder(["Beta", "Gamma", "Alpha"]);
    const search = page.getByRole("searchbox", { name: "Search workspaces" });
    await search.fill("Alpha");
    assert.equal(await cards.count(), 1);
    assert.equal(await page.getByRole("button", { name: /^Reorder / }).count(), 0);
    await search.fill("");
    await page.screenshot({ path: `design-gallery/workspace-reorder/${name}.png` });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    assert.deepEqual(errors, []);
    console.log(
      `${name}: PASS drag, persistence, keyboard, cancellation, click-only move, focus, expansion, rollback and search`,
    );
    await page.close();
  } finally {
    await browser.close();
  }
}
