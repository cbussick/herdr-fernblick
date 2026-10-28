// Synthetic keyboard geometry through the real app. No live Herdr/Pi traffic.
// Models visual-only resize and layout resize followed by focus panning; not a physical iPad keyboard.
// Run after npm run build: node tools/design/visual-viewport.mjs
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { createHttpServer } from "../../dist-server/server/http/server.js";
const { chromium, webkit } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const agent = {
  agent: "pi",
  name: "Keyboard fixture",
  pane_id: "w1:p1",
  tab_id: "w1:t1",
  tab_label: "Keyboard",
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
    runtime: "a0000000-0000-4000-8000-000000000001",
    epoch: "a0000000-0000-4000-8000-000000000002",
    sessionId: "keyboard-fixture",
    pid: 1,
    processStart: "1",
    pane: agent.pane_id,
    herdrSocket: "/fixture.sock",
    sessionFile: "/fixture.jsonl",
  },
  epoch: "a0000000-0000-4000-8000-000000000002",
  seq: 1,
  busy: false,
  sendPending: false,
  truncated: false,
  messages: [{ id: "m1", role: "assistant", text: "The latest reply stays above the composer." }],
  status: { cwd: "/fixture", totalTokens: 0, cost: 0 },
};
const server = createHttpServer(
  { getDashboard: async () => ({ agents: [], tabs: [], workspaces: [] }) },
  resolve("dist"),
  {},
);
await new Promise((done) => server.listen(0, "127.0.0.1", done));
await mkdir("design-gallery/visual-viewport", { recursive: true });
try {
  for (const [name, engine] of [
    ["chromium", chromium],
    ["webkit", webkit],
  ]) {
    const browser = await engine.launch({ headless: true });
    try {
      for (const mode of ["focus-pan", "visual-only"]) {
        const page = await browser.newPage({
          viewport: { width: 810, height: 1080 },
          screen: { width: 810, height: 1080 },
          hasTouch: true,
          serviceWorkers: "block",
        });
        const errors = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.addInitScript((initial) => {
          // A software keyboard does not rotate/shrink the physical screen.
          Object.defineProperty(screen, "width", { configurable: true, get: () => 810 });
          Object.defineProperty(screen, "height", { configurable: true, get: () => 1080 });
          const viewport = Object.assign(new EventTarget(), {
            width: innerWidth,
            height: innerHeight,
            offsetTop: 0,
            offsetLeft: 0,
            scale: 1,
          });
          Object.defineProperty(window, "visualViewport", { configurable: true, value: viewport });
          window.fixtureViewport = viewport;
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
        }, snapshot);
        await page.route(
          (url) => url.pathname.startsWith("/api/"),
          (route) => {
            const path = new URL(route.request().url()).pathname;
            if (path === "/api/agents")
              return route.fulfill({
                json: {
                  agents: [agent],
                  tabs: [],
                  workspaces: [{ workspace_id: "w1", label: "Fixture" }],
                },
              });
            return route.fulfill({ status: 503, json: { error: "Synthetic keyboard fixture" } });
          },
        );
        await page.goto(`http://127.0.0.1:${server.address().port}`);
        await page.getByRole("tab", { name: "Agents", exact: true }).click();
        await page.getByTestId("pane-row").click();
        await page.getByLabel("Pi session status").waitFor();
        const prompt = page.locator("#agent-prompt");
        await prompt.fill("Keep this draft");
        const frame = () =>
          page.evaluate(
            () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
          );
        const setVisual = async (patch) => {
          await page.evaluate((patch) => {
            Object.assign(window.fixtureViewport, patch);
            window.fixtureViewport.dispatchEvent(new Event("resize"));
            window.fixtureViewport.dispatchEvent(new Event("scroll"));
          }, patch);
          await frame();
        };
        async function aligned() {
          const actual = await page.evaluate(() => {
            const vv = window.fixtureViewport;
            const header = document
              .querySelector('[data-testid="console-header"]')
              .getBoundingClientRect();
            const footer = document
              .querySelector('[aria-label="Pi session status"]')
              .getBoundingClientRect();
            const editor = document.querySelector("#agent-prompt").getBoundingClientRect();
            return {
              headerTop: header.top,
              footerBottom: footer.bottom,
              editorTop: editor.top,
              editorBottom: editor.bottom,
              visibleTop: vv.offsetTop,
              visibleBottom: vv.offsetTop + vv.height,
            };
          });
          assert.ok(
            Math.abs(actual.headerTop - actual.visibleTop) < 1,
            `Header must stay at the visible top: ${JSON.stringify(actual)}`,
          );
          assert.ok(
            Math.abs(actual.footerBottom - actual.visibleBottom) < 2,
            `No blank gap or overlap above keyboard: ${JSON.stringify(actual)}`,
          );
          assert.ok(
            actual.editorTop >= actual.visibleTop && actual.editorBottom <= actual.visibleBottom,
            "Focused editor stays within the visible rectangle",
          );
          assert.equal(
            await page.getByTestId("agent-list").isVisible(),
            false,
            "Keyboard must not reveal the sidebar",
          );
          assert.equal(await prompt.inputValue(), "Keep this draft");
        }
        await aligned();
        if (mode === "focus-pan") {
          // Replay a resized layout followed by visual-viewport panning to reveal the focused editor.
          await page.setViewportSize({ width: 810, height: 736 });
          await setVisual({ height: 736, offsetTop: 280 });
        } else {
          // Safari can keep layout/dvh unchanged while only the visual viewport shrinks.
          await setVisual({ height: 736, offsetTop: 0 });
        }
        await aligned();
        await setVisual({ offsetTop: 40 });
        await aligned();
        // Blur and viewport restoration are separate events on mobile browsers.
        await prompt.blur();
        await aligned();
        await page.setViewportSize({ width: 810, height: 1080 });
        await setVisual({ height: 1080, offsetTop: 0 });
        await aligned();
        // Replay the dimensions/scale captured after switching back to the iPad PWA.
        // This checks layout recovery, not Safari's physical app-switch zoom trigger.
        await page.setViewportSize({ width: 1080, height: 778 });
        await setVisual({ width: 1080, height: 778 });
        await page.evaluate(() => {
          Object.assign(window.fixtureViewport, {
            width: 810,
            height: 1048,
            scale: 1.347043752670288,
          });
        });
        await page.setViewportSize({ width: 810, height: 1048 });
        await frame();
        await aligned();
        await setVisual({ scale: 1 });
        await aligned();
        // A visibility event alone must also refresh the saved pixel geometry.
        await page.evaluate(() => {
          window.fixtureViewport.height = 1000;
          document.dispatchEvent(new Event("visibilitychange"));
        });
        await frame();
        await aligned();
        assert.deepEqual(errors, []);
        await page.screenshot({
          path: `design-gallery/visual-viewport/${name}-${mode}-restored.png`,
        });
        console.log(
          `${name}/${mode}: keyboard/pan, zoomed layout recovery, resume remeasurement and draft checks passed`,
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
