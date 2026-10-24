// Synthetic production browser regression. No real Herdr/Pi APIs or service workers.
// PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node tools/design/pwa-whiteboard.mjs
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { createHttpServer } from "../../dist-server/server/http/server.js";
const { chromium, webkit } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const target = {
  runtime: "a0000000-0000-4000-8000-000000000001",
  epoch: "a0000000-0000-4000-8000-000000000002",
  sessionId: "update-fixture",
};
const agent = {
  agent: "pi",
  name: "update-fixture",
  pane_id: "w1:p1",
  tab_id: "w1:t1",
  tab_label: "Update fixture",
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
  capabilities: { boards: true },
  messages: [],
  status: { cwd: "/fixture", totalTokens: 0, cost: 0 },
};
const server = createHttpServer(
  { getDashboard: async () => ({ agents: [], tabs: [], workspaces: [] }) },
  resolve("dist"),
  {},
);
await new Promise((done) => server.listen(0, "127.0.0.1", done));
try {
  for (const [name, engine] of [
    ["chromium", chromium],
    ["webkit", webkit],
  ]) {
    const browser = await engine.launch({ headless: true });
    try {
      for (const timing of ["before", "after"]) {
        const page = await browser.newPage({
          viewport: { width: 390, height: 844 },
          hasTouch: true,
          serviceWorkers: "block",
        });
        const errors = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.addInitScript(
          ({ snapshot }) => {
            window.EventSource = class {
              constructor(url) {
                if (!String(url).includes("/board/"))
                  this.timer = setTimeout(
                    () => this.onmessage?.({ data: JSON.stringify(snapshot) }),
                    20,
                  );
              }
              close() {
                clearTimeout(this.timer);
              }
            };
            const serviceWorker = new EventTarget();
            const registration = new EventTarget();
            registration.waiting = null;
            registration.update = async () => {};
            serviceWorker.controller = {};
            serviceWorker.register = async () => registration;
            Object.defineProperty(navigator, "serviceWorker", {
              configurable: true,
              value: serviceWorker,
            });
            window.fixtureApplyCount = 0;
            window.fixtureUpdate = () => {
              const worker = new EventTarget();
              worker.state = "installed";
              worker.postMessage = () => {
                window.fixtureApplyCount++;
                // Exercise the real apply/error path without reloading the fixture page.
                throw new Error("Synthetic update reached");
              };
              registration.waiting = worker;
              registration.installing = worker;
              registration.dispatchEvent(new Event("updatefound"));
              worker.dispatchEvent(new Event("statechange"));
            };
          },
          { snapshot },
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
            if (path.endsWith("/board"))
              return route.fulfill({
                json: {
                  id: "a".repeat(64),
                  revision: 1,
                  scene: { elements: [], files: {}, background: "#ffffff" },
                  updatedAt: 1,
                  lastAuthor: "human",
                  snapshots: [],
                  access: null,
                },
              });
            return route.fulfill({ status: 403, json: { error: "Unexpected fixture request" } });
          },
        );
        await page.goto(`http://127.0.0.1:${server.address().port}`);
        await page.getByRole("tab", { name: "Agents", exact: true }).click();
        await page.getByTestId("pane-row").click();
        await page.getByLabel("Pi session status").waitFor();
        if (timing === "before") await page.evaluate(() => window.fixtureUpdate());
        const openBoard = page.getByRole("button", { name: /whiteboard/i });
        await openBoard.focus();
        await page.keyboard.press("Enter");
        const board = page.getByTestId("whiteboard");
        await board.waitFor();
        await board.locator("canvas").first().waitFor();
        const input = board.getByRole("textbox", { name: "Message the agent" });
        await input.fill("Keep my whiteboard draft");
        // Keyboard-sized viewport without requiring a physical software keyboard.
        await page.setViewportSize({ width: 390, height: 500 });
        if (timing === "after") await page.evaluate(() => window.fixtureUpdate());
        const later = page.getByRole("button", { name: "Later", exact: true });
        await later.waitFor();
        // Check wrapping in DOM order whether the notice mounted before or after
        // the whiteboard. Neither boundary may escape into the inert app root.
        await page.evaluate(() => {
          const roots = [
            document.querySelector('[data-testid="whiteboard"]'),
            document.querySelector('[data-ui="app-status"]'),
          ];
          const controls = [
            ...document.querySelectorAll("button, a[href], input, textarea, select, [tabindex]"),
          ].filter(
            (element) =>
              roots.some((root) => root.contains(element)) &&
              element.tabIndex >= 0 &&
              !element.matches(":disabled") &&
              !element.closest("[inert]") &&
              element.getClientRects().length,
          );
          window.fixtureFirst = controls[0];
          window.fixtureLast = controls.at(-1);
          window.fixtureFirst.focus();
        });
        await page.keyboard.press("Shift+Tab");
        assert.equal(
          await page.evaluate(() => document.activeElement === window.fixtureLast),
          true,
          "Shift+Tab wraps within whiteboard and notice",
        );
        await page.keyboard.press("Tab");
        assert.equal(
          await page.evaluate(() => document.activeElement === window.fixtureFirst),
          true,
          "Tab wraps within whiteboard and notice",
        );
        // Raw touch hit-testing, not dispatchEvent or forced locator clicks.
        const box = await later.boundingBox();
        await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
        await page.waitForTimeout(100);
        assert.equal(
          await later.count(),
          0,
          `${name}/${timing}: tapping Later must dismiss the update, not focus the underlying composer`,
        );
        assert.equal(await input.inputValue(), "Keep my whiteboard draft");
        assert.equal(await page.locator("#root").evaluate((element) => element.inert), true);
        await page.evaluate(() => window.fixtureUpdate());
        const refresh = page.getByRole("button", { name: "Refresh app", exact: true });
        await refresh.waitFor();
        const refreshBox = await refresh.boundingBox();
        await page.touchscreen.tap(
          refreshBox.x + refreshBox.width / 2,
          refreshBox.y + refreshBox.height / 2,
        );
        await page.getByText("Synthetic update reached", { exact: true }).waitFor();
        assert.equal(
          await page.evaluate(() => window.fixtureApplyCount),
          1,
          "touch reaches Refresh app",
        );
        await refresh.focus();
        assert.equal(
          await refresh.evaluate((element) => document.activeElement === element),
          true,
          "update action accepts focus",
        );
        await page.keyboard.press("Tab");
        assert.equal(
          await later.evaluate((element) => document.activeElement === element),
          true,
          "whiteboard focus trap includes update actions",
        );
        await page.keyboard.press("Shift+Tab");
        await page.keyboard.press("Enter");
        await page.waitForFunction(() => window.fixtureApplyCount === 2);
        assert.equal(await input.inputValue(), "Keep my whiteboard draft");
        await page.keyboard.press("Escape");
        assert.equal(await board.count(), 1, "Escape from the notice must not close whiteboard");
        await page.keyboard.press("Tab");
        await page.keyboard.press("Enter");
        await later.waitFor({ state: "detached" });
        await board.getByRole("button", { name: /Back/ }).click();
        assert.equal(
          await page.locator("#root").evaluate((element) => element.inert),
          false,
          "background interactivity is restored",
        );
        assert.deepEqual(errors, []);
        console.log(
          `${name}/${timing}: touch dismissal, keyboard refresh, draft and inert restoration passed`,
        );
        await page.close();
      }
    } finally {
      await browser.close();
    }
  }
} finally {
  await new Promise((done) => server.close(done));
}
