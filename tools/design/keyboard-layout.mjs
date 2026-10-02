// Keyboard-height regression: intercept all API traffic; never control real agents.
// PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node tools/design/keyboard-layout.mjs URL
import assert from "node:assert/strict";
const { chromium, webkit } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.argv[2] || "http://100.71.229.1:5185";
const target = {
  runtime: "a0000000-0000-4000-8000-000000000001",
  epoch: "a0000000-0000-4000-8000-000000000002",
  sessionId: "keyboard-fixture",
};
const agent = {
  agent: "pi",
  name: "keyboard-fixture",
  pane_id: "w1:p1",
  tab_id: "w1:t1",
  tab_label: "Keyboard layout",
  workspace_id: "w1",
  workspace_label: "Fixture",
  agent_status: "idle",
  revision: 1,
  focused: false,
  agent_session: { agent: "pi", kind: "path", source: "fixture", value: "/fixture.jsonl" },
};
const snapshot = {
  type: "snapshot",
  version: 2,
  identity: {
    ...target,
    pid: 1,
    processStart: "1",
    pane: agent.pane_id,
    herdrSocket: "/fixture.sock",
    sessionFile: "/fixture.jsonl",
  },
  epoch: target.epoch,
  seq: 1,
  busy: false,
  sendPending: false,
  truncated: false,
  capabilities: { skills: true },
  messages: [],
  status: { cwd: "/fixture", totalTokens: 0, cost: 0 },
};
for (const [name, engine] of [
  ["chromium", chromium],
  ["webkit", webkit],
]) {
  const browser = await engine.launch({ headless: true });
  try {
    for (const [width, height, keyboardHeight] of [
      [768, 1024, 550],
      [834, 1194, 650],
      [1024, 1366, 760],
    ]) {
      const page = await browser.newPage({
        viewport: { width, height },
        screen: { width, height },
        hasTouch: true,
      });
      const settle = () =>
        page.evaluate(
          () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
        );
      await page.addInitScript(
        ({ initial, screenSize }) => {
          // Playwright setViewportSize also resets its emulated screen dimensions.
          // Keep these fixed to model a keyboard, not a physical rotation.
          window.fixtureScreen = screenSize;
          Object.defineProperty(screen, "width", {
            configurable: true,
            get: () => window.fixtureScreen.width,
          });
          Object.defineProperty(screen, "height", {
            configurable: true,
            get: () => window.fixtureScreen.height,
          });
          window.EventSource = class {
            constructor() {
              this.timer = setTimeout(
                () => this.onmessage?.({ data: JSON.stringify(initial) }),
                20,
              );
            }
            close() {
              clearTimeout(this.timer);
            }
          };
        },
        { initial: snapshot, screenSize: { width, height } },
      );
      await page.route(
        (url) => url.pathname.startsWith("/api/"),
        (route) => {
          const path = new URL(route.request().url()).pathname;
          if (path === "/api/agents")
            return route.fulfill({
              json: {
                agents: [agent],
                workspaces: [{ workspace_id: "w1", label: "Fixture" }],
                tabs: [],
              },
            });
          if (path.endsWith("/skills"))
            return route.fulfill({
              json: {
                type: "skills",
                id: target.runtime,
                target,
                truncated: false,
                skills: [
                  {
                    name: "review",
                    description: "Review a draft",
                    path: "/fixture/SKILL.md",
                    scope: "project",
                  },
                ],
              },
            });
          return route.fulfill({ status: 403, json: { error: "Unexpected fixture request" } });
        },
      );
      await page.goto(base);
      await page.getByRole("tab", { name: "Agents", exact: true }).click();
      await page.getByTestId("pane-row").click();
      await page.getByLabel("Pi session status").waitFor();
      const sidebar = page.getByTestId("agent-list");
      const chat = page.getByTestId("console");
      assert.equal(await sidebar.isVisible(), false, "portrait chat starts full-width");
      await page.locator("#agent-prompt").fill("Keep this draft");
      // Desktop browser automation cannot show iPadOS's software keyboard. Hold
      // the physical screen portrait and shrink only the usable viewport.
      await page.setViewportSize({ width, height: keyboardHeight });
      await settle();
      const state = await page.evaluate(() => ({
        viewport: [innerWidth, innerHeight],
        screen: [screen.width, screen.height],
        viewportLandscape: matchMedia("(orientation: landscape)").matches,
        focused: document.activeElement?.id,
        touchPoints: navigator.maxTouchPoints,
        coarsePointer: matchMedia("(any-pointer: coarse)").matches,
        singlePane: document.querySelector("[data-detail-open]")?.hasAttribute("data-single-pane"),
        chatWidth: document.querySelector('[data-testid="console"]').getBoundingClientRect().width,
      }));
      console.log(name, JSON.stringify(state));
      assert.equal(
        await sidebar.isVisible(),
        false,
        "keyboard opening must not reveal the workspace sidebar",
      );
      assert.ok(
        (await chat.boundingBox()).width >= width - 1,
        "portrait chat keeps its full width with the keyboard open",
      );
      assert.equal(await page.locator("#agent-prompt").inputValue(), "Keep this draft");
      const trigger = page.getByRole("button", { name: "Skills", exact: true });
      await trigger.click();
      await page.getByRole("combobox", { name: "Search skills" }).fill("review");
      assert.equal(
        await sidebar.isVisible(),
        false,
        "skills search keeps portrait chat full-width",
      );
      await page.getByRole("combobox").press("Escape");
      // Blurring does not necessarily dismiss a mobile keyboard immediately.
      await page.locator("#agent-prompt").blur();
      assert.equal(await sidebar.isVisible(), false, "layout does not depend on current focus");
      await page.setViewportSize({ width, height });
      await settle();
      assert.equal(await sidebar.isVisible(), false, "closing keyboard preserves portrait layout");
      await page.locator("#agent-prompt").focus();
      await page.evaluate(
        ({ width, height }) => {
          window.fixtureScreen = { width: height, height: width };
        },
        { width, height },
      );
      await page.setViewportSize({ width: height, height: keyboardHeight });
      await page.evaluate(() => window.dispatchEvent(new Event("orientationchange")));
      await settle();
      assert.equal(
        await sidebar.isVisible(),
        true,
        "real landscape rotation still reveals the sidebar",
      );
      await page.evaluate(
        (screenSize) => {
          window.fixtureScreen = screenSize;
        },
        { width, height },
      );
      await page.setViewportSize({ width, height: keyboardHeight });
      await page.evaluate(() => window.dispatchEvent(new Event("orientationchange")));
      await settle();
      assert.equal(
        await sidebar.isVisible(),
        false,
        "rotation back to portrait with keyboard open restores full-width chat",
      );
      assert.equal(await page.locator("#agent-prompt").inputValue(), "Keep this draft");
      await page.getByRole("button", { name: "Back to overview" }).click();
      assert.equal(
        await sidebar.isVisible(),
        true,
        "back navigation still reaches the workspace list",
      );
      assert.ok((await sidebar.boundingBox()).width >= width - 1);
      await page.getByRole("searchbox").fill("Keyboard");
      assert.equal(await page.getByTestId("pane-row").count(), 1);
      assert.ok(
        (await sidebar.boundingBox()).width >= width - 1,
        "overview search is full-width too",
      );
      console.log(
        `${name}/${width}: composer, skills search, keyboard close, rotation, draft and back navigation passed`,
      );
      await page.close();
    }
  } finally {
    await browser.close();
  }
}
