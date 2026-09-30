// Browser-level checks for the generated gallery and the responsive proposal.
import assert from "node:assert/strict";
const { chromium, webkit } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const gallery = process.argv[2] || "http://100.71.229.1:5197";
const app = process.argv[3] || "http://127.0.0.1:5198";
for (const [name, engine] of Object.entries({ chromium, webkit })) {
  const browser = await engine.launch({ headless: true });
  for (const width of [320, 390, 768, 834, 1024, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(gallery);
    await page.locator(".card").first().waitFor();
    assert.equal(await page.locator(".card").count(), 52);
    await page.getByRole("button", { name: "Compare Agent conversation", exact: true }).click();
    assert.equal(await page.locator("dialog[open] img").count(), 2);
    await page
      .locator("dialog[open] img")
      .evaluateAll((images) => Promise.all(images.map((img) => img.decode())));
    await page.getByRole("button", { name: "Zoom", exact: true }).click();
    assert.equal(await page.locator("#zoom").getAttribute("aria-pressed"), "true");
    await page.getByRole("button", { name: "After only", exact: true }).click();
    assert.equal(await page.locator("dialog[open] figure:visible").count(), 1);
    await page.keyboard.press("ArrowRight");
    assert.equal(await page.locator("#lightbox-title").textContent(), "Agent working / Stop");
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("dialog[open]").count(), 0);
    await page.getByRole("button", { name: /iPad ·/ }).click();
    assert.equal(await page.locator(".card").count(), 52);
    await page.getByRole("searchbox").fill("paths");
    assert.equal(await page.locator(".card").count(), 7);
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    await page.goto(`${gallery}/?phase=before`);
    await page.locator(".card").first().waitFor();
    await page.locator(".card").first().click();
    assert.equal(await page.locator("dialog[open] img").count(), 1);
    await page.keyboard.press("Escape");
    // Isolated API fixture; deliberately no real Herdr backend.
    await page.route(
      (url) => url.pathname.startsWith("/api/"),
      (route) =>
        route.request().url().endsWith("/chat")
          ? route.fulfill({
              contentType: "text/event-stream",
              body: 'data: {"type":"unavailable","reason":"Design fixture"}\n\n',
            })
          : route.fulfill({
              json: {
                agents: [
                  {
                    agent: "pi",
                    name: "fixture",
                    pane_id: "w1:p1",
                    tab_id: "w1:t1",
                    tab_label: "A long agent label that must not push controls off screen",
                    agent_status: "blocked",
                    workspace_id: "w1",
                    workspace_label: "Design fixture",
                    focused: false,
                    revision: 1,
                  },
                ],
                tabs: [],
                workspaces: [{ workspace_id: "w1", label: "Design fixture" }],
              },
            }),
    );
    await page.goto(app);
    await page.getByRole("searchbox", { name: "Search workspaces" }).waitFor();
    assert.equal(await page.locator(".overview-header__summary").count(), 0);
    const chevron = page.locator(".workspace-disclosure summary > svg").first();
    assert.ok(
      await chevron.evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).b < -0.99),
      "Collapsed chevron must point up",
    );
    await page.locator(".workspace-disclosure summary").first().click();
    await page.waitForTimeout(180);
    assert.ok(
      await chevron.evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).b > 0.99),
      "Expanded chevron must point down",
    );
    await page.getByRole("searchbox", { name: "Search workspaces" }).fill("no matching workspace");
    await page.locator(".overview-empty svg").waitFor();
    const icon = await page.locator(".overview-empty .empty-state-icon").boundingBox();
    const heading = await page.locator(".overview-empty strong").boundingBox();
    assert.ok(icon.y + icon.height <= heading.y, "Empty-state icon must be above the heading");
    await page.getByRole("searchbox", { name: "Search workspaces" }).fill("");
    await page.getByRole("tab", { name: "Agents", exact: true }).click();
    await page.getByRole("searchbox", { name: "Search agents" }).fill("no matching agent");
    await page.locator(".overview-empty svg").waitFor();
    await page.getByRole("searchbox", { name: "Search agents" }).fill("");
    await page.locator(".pane-row").click();
    assert.equal(await page.locator(".agent-list").isVisible(), width >= 768);
    const targets = await page.locator(".console-header > button").evaluateAll((buttons) =>
      buttons.map((button) => {
        const r = button.getBoundingClientRect();
        return {
          label: button.getAttribute("aria-label"),
          width: r.width,
          height: r.height,
          visible: r.left >= 0 && r.right <= innerWidth,
          hit: button.contains(
            document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2),
          ),
        };
      }),
    );
    for (const target of targets) {
      assert.ok(target.visible && target.hit, `${name} ${width}: obscured ${target.label}`);
      assert.ok(
        target.width >= 44 && target.height >= 44,
        `${name} ${width}: small ${target.label}`,
      );
    }
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    await page.getByRole("button", { name: "Back to overview" }).click();
    assert.equal(await page.locator(".agent-list").isVisible(), true);
    assert.deepEqual(errors, []);
    console.log(
      `${name}: ${width}px gallery, lightbox, filters, navigation and touch targets passed`,
    );
    await page.close();
  }
  await browser.close();
}
