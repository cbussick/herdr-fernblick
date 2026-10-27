// Synthetic header-layout regression; no live Herdr/Pi sockets or commands.
// Run after npm run build: node tools/design/safe-area.mjs
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { createHttpServer } from "../../dist-server/server/http/server.js";
const { chromium, webkit } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const agent = {
  agent: "pi",
  name: "Safe-area fixture",
  pane_id: "w1:p1",
  tab_id: "w1:t1",
  tab_label: "Header fixture",
  workspace_id: "w1",
  workspace_label: "Fixture",
  agent_status: "idle",
  revision: 1,
  focused: false,
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
      for (const inset of [24, 0]) {
        const page = await browser.newPage({
          viewport: { width: 834, height: 1194 },
          hasTouch: true,
          serviceWorkers: "block",
        });
        const errors = [];
        let substitutions = 0;
        page.on("pageerror", (error) => errors.push(error.message));
        // Headless browsers have no OS status bar. Substitute only the env()
        // value in the real built stylesheet, preserving its layout expressions.
        await page.route("**/*.css", async (route) => {
          const response = await route.fetch();
          const body = (await response.text()).replace(
            /env\(safe-area-inset-top(?:,\s*0px)?\)/g,
            () => {
              substitutions++;
              return `${inset}px`;
            },
          );
          await route.fulfill({ response, body });
        });
        await page.addInitScript(() => {
          window.EventSource = class {
            constructor() {
              this.timer = setTimeout(
                () =>
                  this.onmessage?.({
                    data: JSON.stringify({ type: "unavailable", reason: "Layout fixture" }),
                  }),
                20,
              );
            }
            close() {
              clearTimeout(this.timer);
            }
          };
        });
        await page.route(
          (url) => url.pathname.startsWith("/api/"),
          (route) =>
            new URL(route.request().url()).pathname === "/api/agents"
              ? route.fulfill({
                  json: {
                    agents: [agent],
                    tabs: [],
                    workspaces: [{ workspace_id: "w1", label: "Fixture" }],
                  },
                })
              : route.fulfill({ status: 503, json: { error: "Layout fixture" } }),
        );
        await page.goto(`http://127.0.0.1:${server.address().port}`);
        await page.getByRole("tab", { name: "Agents", exact: true }).click();
        async function checkHeader(testId, spacing) {
          const header = page.getByTestId(testId);
          const geometry = await header.evaluate((node) => {
            const style = getComputedStyle(node);
            const bounds = node.getBoundingClientRect();
            return {
              top: bounds.top,
              padding: parseFloat(style.paddingTop),
              background: style.backgroundColor,
              filter: style.backdropFilter,
            };
          });
          assert.equal(geometry.top, 0, "Header background must reach the viewport top");
          assert.equal(geometry.padding, inset + spacing, `${testId}: retain spacing below inset`);
          assert.ok(!geometry.background.includes("rgba"), "Header must remain opaque");
          assert.equal(geometry.filter, "none");
          for (const button of await header.getByRole("button").all()) {
            if (!(await button.isVisible())) continue;
            const bounds = await button.boundingBox();
            assert.ok(bounds.y >= inset, "Header controls must clear the status bar");
          }
        }
        assert.ok(substitutions > 0, "Must exercise a simulated safe-area inset");
        await checkHeader("overview-header", 24);
        await page.getByTestId("pane-row").click();
        await page.getByTestId("console-header").waitFor();
        for (const viewport of [
          { width: 834, height: 1194 },
          { width: 1194, height: 834 },
          { width: 1440, height: 1000 },
        ]) {
          await page.setViewportSize(viewport);
          await checkHeader("console-header", 12);
          assert.equal(
            await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
            false,
            "Safe-area spacing must not introduce horizontal overflow",
          );
        }
        await page.setViewportSize({ width: 810, height: 1048 });
        await checkHeader("console-header", 12);
        await page.getByRole("button", { name: "Back to overview", exact: true }).click();
        await page.getByRole("button", { name: "Open settings", exact: true }).click();
        await page.getByRole("button", { name: "View diagnostics", exact: true }).click();
        const diagnostics = JSON.parse(
          await page.locator('pre[aria-label="Diagnostics"]').textContent(),
        );
        assert.equal(diagnostics.headerLayout.version, 1);
        const consoleCapture = diagnostics.headerLayout.console;
        assert.ok(consoleCapture, "Retain conversation geometry after navigating to Settings");
        assert.equal(consoleCapture.header.paddingTop, `${inset + 12}px`);
        assert.equal(consoleCapture.viewport.layout.width, 810);
        assert.equal(consoleCapture.viewport.visual.offsetTop, 0);
        assert.ok(consoleCapture.contextLine.bounds.height > 0);
        assert.ok(consoleCapture.ancestors.length > 0);
        assert.ok(diagnostics.headerLayout.overview);
        assert.ok(!JSON.stringify(diagnostics.headerLayout).includes(agent.name));
        assert.deepEqual(errors, []);
        console.log(
          `${name}: inset ${inset}px, overview and portrait/landscape/desktop headers PASS`,
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
