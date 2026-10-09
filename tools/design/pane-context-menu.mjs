// Synthetic API fixtures only; never connects to a live Herdr session.
// PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node tools/design/pane-context-menu.mjs URL
import assert from "node:assert/strict";
const { chromium, webkit } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const app = process.argv[2] || "http://127.0.0.1:5204";
const agents = Array.from({ length: 20 }, (_, index) => ({
  agent: "pi",
  name: `fixture-${index}`,
  pane_id: `w1:p${index}`,
  tab_id: `w1:t${index}`,
  tab_label: `Fixture ${index}`,
  agent_status: "idle",
  workspace_id: "w1",
  workspace_label: "Menu fixture",
  focused: false,
  revision: 1,
}));

async function assertVisibleMenu(page) {
  const menu = page.getByRole("menu");
  await menu.waitFor();
  const visibility = await menu.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const viewport = window.visualViewport;
    const left = viewport?.offsetLeft ?? 0;
    const top = viewport?.offsetTop ?? 0;
    return {
      withinViewport:
        rect.left >= left &&
        rect.top >= top &&
        rect.right <= left + (viewport?.width ?? innerWidth) &&
        rect.bottom <= top + (viewport?.height ?? innerHeight),
      itemsReachable: [...element.querySelectorAll('[role="menuitem"]')].every((item) => {
        const box = item.getBoundingClientRect();
        return item.contains(
          document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2),
        );
      }),
      rect: rect.toJSON(),
    };
  });
  assert.ok(visibility.withinViewport, `Menu must fit viewport: ${JSON.stringify(visibility)}`);
  assert.ok(
    visibility.itemsReachable,
    `Every action must be unclipped: ${JSON.stringify(visibility)}`,
  );
}

for (const [name, engine] of Object.entries({ chromium, webkit })) {
  if (process.env.DESIGN_BROWSER && process.env.DESIGN_BROWSER !== name) continue;
  const browser = await engine.launch({ headless: true });
  try {
    for (const viewport of [
      { width: 390, height: 600 },
      { width: 834, height: 1194 },
      { width: 1194, height: 834 },
      { width: 1440, height: 900 },
    ]) {
      const page = await browser.newPage({ viewport, hasTouch: true });
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route(
        (url) => url.pathname.startsWith("/api/"),
        (route) => {
          assert.equal(route.request().method(), "GET", "No live mutations in this test");
          return route.fulfill({
            json: { agents, tabs: [], workspaces: [{ workspace_id: "w1", label: "Menu fixture" }] },
          });
        },
      );
      await page.goto(app);
      await page.evaluate(() => document.fonts.ready);
      await page.getByTestId("workspace-disclosure").locator("summary").click();
      for (const grouped of [true, false]) {
        if (!grouped) await page.getByRole("tab", { name: "Agents", exact: true }).click();
        const row = page.getByTestId("pane-row").last();
        await row.scrollIntoViewIfNeeded();
        await row.dispatchEvent("pointerdown", { pointerType: "touch", pointerId: 1, button: 0 });
        await page.getByRole("menu").waitFor();
        await row.dispatchEvent("pointerup", { pointerType: "touch", pointerId: 1, button: 0 });
        await assertVisibleMenu(page);
        // The click following a long press must not navigate into the row.
        await row.dispatchEvent("click");
        await assertVisibleMenu(page);
        await page.getByRole("menuitem", { name: "Edit agent", exact: true }).click();
        await page.getByRole("dialog").waitFor();
        await page.getByRole("button", { name: "Cancel", exact: true }).click();
        await row.click({ button: "right" });
        await assertVisibleMenu(page);
        await page.keyboard.press("Escape");
        await page.getByRole("menu").waitFor({ state: "hidden" });
        await row.click({ button: "right" });
        await assertVisibleMenu(page);
        await page.setViewportSize({ width: viewport.width, height: viewport.height - 100 });
        await assertVisibleMenu(page);
        await page.setViewportSize(viewport);
        await assertVisibleMenu(page);
        await page.mouse.click(viewport.width - 4, 4);
        await page.getByRole("menu").waitFor({ state: "hidden" });
      }
      assert.deepEqual(errors, []);
      await page.close();
      console.log(`${name} ${viewport.width}x${viewport.height}: PASS`);
    }
  } finally {
    await browser.close();
  }
}
