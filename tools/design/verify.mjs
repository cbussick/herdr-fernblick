import { appSelector } from "./selectors.mjs";
// Browser-level checks for the generated gallery and the responsive proposal.
import assert from "node:assert/strict";
const { chromium, webkit } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const gallery = process.argv[2] || "http://100.71.229.1:5197";
const app = process.argv[3] || "http://127.0.0.1:5198";
for (const [name, engine] of Object.entries({ chromium, webkit })) {
  if (process.env.DESIGN_BROWSER && process.env.DESIGN_BROWSER !== name) continue;
  const browser = await engine.launch({ headless: true });
  for (const { width, height } of [
    { width: 320, height: 1000 },
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 834, height: 1194 },
    { width: 1024, height: 1366 },
    { width: 1024, height: 768 },
    { width: 1194, height: 834 },
    { width: 1440, height: 1000 },
  ]) {
    const page = await browser.newPage({ viewport: { width, height } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(gallery);
    await page.locator(".screen-group").first().waitFor();
    assert.equal(await page.locator(".screen-group").count(), 53);
    assert.equal(await page.locator(".card").count(), 159);
    assert.deepEqual(
      await page
        .locator(".screen-group")
        .evaluateAll((groups) =>
          groups.map((group) =>
            [...group.querySelectorAll(".card")].map((card) => card.dataset.viewport),
          ),
        ),
      Array.from({ length: 53 }, () => ["phone", "ipad", "desktop"]),
    );
    await page
      .locator(".screen-group")
      .first()
      .locator("img")
      .evaluateAll((images) =>
        Promise.all(
          images.map((image) => {
            image.loading = "eager"; // WebKit will not decode an offscreen lazy image until it is requested.
            return image.decode();
          }),
        ),
      );
    await page.getByRole("button", { name: "View Agent conversation, phone", exact: true }).click();
    assert.equal(await page.locator("dialog[open] img").count(), 1);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: /iPad landscape ·/ }).click();
    assert.equal(await page.locator(".card").count(), 53);
    await page.goto(`${gallery}/?phase=compare`);
    await page.locator(".card").first().waitFor();
    assert.equal(await page.locator(".card").count(), 53);
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
    await page.getByRole("button", { name: /iPad portrait ·/ }).click();
    assert.equal(await page.locator(".card").count(), 53);
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
    await page.evaluate(() => document.fonts.ready);
    assert.ok(
      await page.evaluate(
        () =>
          getComputedStyle(document.body).fontFamily.includes("Manrope") &&
          [...document.fonts].some((font) => font.family === "Manrope" && font.status === "loaded"),
      ),
      "Locally hosted Manrope must be loaded in the production build",
    );
    const license = await page.request.get(`${app}/licenses/Manrope-OFL.txt`);
    assert.equal(license.status(), 200);
    assert.ok((await license.text()).includes("SIL OPEN FONT LICENSE Version 1.1"));
    assert.equal(await page.locator(appSelector(".overview-header__summary")).count(), 0);
    const chevron = page.locator(appSelector(".workspace-disclosure summary > svg")).first();
    assert.ok(
      await chevron.evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).b < -0.99),
      "Collapsed chevron must point up",
    );
    await page.locator(appSelector(".workspace-disclosure summary")).first().click();
    await page.waitForTimeout(180);
    assert.ok(
      await chevron.evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).b > 0.99),
      "Expanded chevron must point down",
    );
    await page.getByRole("searchbox", { name: "Search workspaces" }).fill("no matching workspace");
    await page.locator(appSelector(".overview-empty svg")).waitFor();
    const icon = await page.locator(appSelector(".overview-empty .empty-state-icon")).boundingBox();
    const heading = await page.locator(appSelector(".overview-empty strong")).boundingBox();
    assert.ok(icon.y + icon.height <= heading.y, "Empty-state icon must be above the heading");
    await page.getByRole("searchbox", { name: "Search workspaces" }).fill("");
    await page.getByRole("tab", { name: "Agents", exact: true }).click();
    await page.getByRole("searchbox", { name: "Search agents" }).fill("no matching agent");
    await page.locator(appSelector(".overview-empty svg")).waitFor();
    await page.getByRole("searchbox", { name: "Search agents" }).fill("");
    assert.equal(
      await page
        .locator(appSelector(".pane-row"))
        .evaluate((row) => getComputedStyle(row.parentElement).backgroundColor),
      "rgb(255, 255, 255)",
    );
    await page.locator(appSelector(".pane-row")).click();
    assert.equal(
      await page.locator(appSelector(".agent-list")).isVisible(),
      width >= 1200 || (width >= 768 && width > height),
    );
    if (width === 834 && height === 1194) {
      await page.setViewportSize({ width: 1194, height: 834 });
      assert.equal(
        await page.locator(appSelector(".agent-list")).isVisible(),
        true,
        "Landscape rotation must reveal the sidebar",
      );
      await page.setViewportSize({ width, height });
      assert.equal(
        await page.locator(appSelector(".agent-list")).isVisible(),
        false,
        "Portrait rotation must restore single-pane navigation",
      );
      assert.equal(
        await page.locator(appSelector(".console")).isVisible(),
        true,
        "Rotation must preserve the selected agent",
      );
    }
    const targets = await page
      .locator(appSelector(".console-header > button"))
      .evaluateAll((buttons) =>
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
    await page.locator(appSelector(".terminal-state--error svg")).waitFor();
    const errorColors = await page
      .locator(appSelector(".terminal-state--error"))
      .evaluate((el) => ({
        icon: getComputedStyle(el.querySelector("svg")).color,
        text: getComputedStyle(el.querySelector("p")).color,
        danger: getComputedStyle(el).getPropertyValue("--color-danger").trim(),
      }));
    assert.equal(errorColors.icon, errorColors.text, "Error icon must match the red message text");
    assert.equal(errorColors.icon, "rgb(198, 74, 59)");
    await page.getByRole("button", { name: "Back to overview" }).click();
    assert.equal(await page.locator(appSelector(".agent-list")).isVisible(), true);
    await page.addInitScript(() => {
      const snapshot = {
        type: "snapshot",
        version: 2,
        identity: {
          runtime: "a0000000-0000-4000-8000-000000000001",
          pid: 123,
          processStart: "fixture",
          pane: "w1:p1",
          herdrSocket: "/fixtures/herdr.sock",
          sessionId: "fixture",
          sessionFile: "/fixtures/session.jsonl",
        },
        epoch: "a0000000-0000-4000-8000-000000000002",
        seq: 1,
        busy: false,
        sendPending: false,
        truncated: false,
        messages: [],
        status: { cwd: "/fixtures", totalTokens: 0, cost: 0 },
      };
      window.EventSource = class {
        constructor() {
          this.snapshot = snapshot;
          window.__fixtureEvents = this;
          this.timer = setTimeout(() => this.onmessage?.({ data: JSON.stringify(snapshot) }), 10);
        }
        close() {
          clearTimeout(this.timer);
        }
      };
    });
    await page.goto(app);
    await page.getByRole("tab", { name: "Agents", exact: true }).click();
    await page.locator(appSelector(".pane-row")).click();
    await page.locator(appSelector(".chat-transcript[data-empty]")).waitFor();
    await page.evaluate(() => document.fonts.ready);
    const panel = await page.locator(appSelector(".output-panel--chat")).boundingBox();
    const emptyIcon = await page
      .locator(appSelector(".chat-transcript [data-state-kind=empty]"))
      .boundingBox();
    const emptyText = await page.getByText("No messages yet.", { exact: true }).boundingBox();
    const groupCenter = (emptyIcon.y + emptyText.y + emptyText.height) / 2;
    assert.ok(
      Math.abs(groupCenter - (panel.y + panel.height / 2)) < 2,
      `${name} ${width}: Empty conversation must be vertically centered`,
    );
    await page.evaluate(() => {
      const events = window.__fixtureEvents;
      events.onmessage({
        data: JSON.stringify({
          ...events.snapshot,
          seq: 2,
          messages: [
            {
              id: "tool",
              role: "tool",
              toolName: "read · AgentOverview.tsx",
              text: "WorkspaceList\n  Workspace disclosure\n  Agent rows and status indicators",
            },
            {
              id: "answer",
              role: "assistant",
              text: "A long answer to verify that the read accordion retains its complete height. ".repeat(
                30,
              ),
            },
          ],
        }),
      });
    });
    const tool = page.locator(appSelector(".chat-tool"));
    await tool.locator("summary").click();
    assert.ok(
      await tool.evaluate((accordion) => {
        const summary = accordion.querySelector("summary").getBoundingClientRect();
        const output = accordion.querySelector("pre").getBoundingClientRect();
        const frame = accordion.getBoundingClientRect();
        return (
          Math.abs(summary.bottom - output.top) < 1 &&
          frame.bottom >= output.bottom &&
          accordion.nextElementSibling.getBoundingClientRect().top >= frame.bottom
        );
      }),
      "Read header and output must share one complete, non-overlapping accordion frame",
    );
    await tool.locator("summary").focus();
    await page.keyboard.press("Space");
    assert.equal(await tool.locator("pre").isVisible(), false);
    await page.keyboard.press("Space");
    assert.equal(await tool.locator("pre").isVisible(), true);
    assert.deepEqual(errors, []);
    console.log(
      `${name}: ${width}×${height} gallery, layout, lightbox, filters, navigation and touch targets passed`,
    );
    await page.close();
  }
  await browser.close();
}
