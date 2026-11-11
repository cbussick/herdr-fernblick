// Synthetic message-copy layout/clipboard regression; never contacts live agents.
// Run after npm run build: node tools/design/message-copy.mjs
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { createHttpServer } from "../../dist-server/server/http/server.js";
const { chromium, webkit } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const agent = {
  agent: "pi",
  name: "Copy fixture",
  pane_id: "w1:p1",
  tab_id: "w1:t1",
  tab_label: "Copy fixture",
  workspace_id: "w1",
  workspace_label: "Fixture",
  agent_status: "idle",
  revision: 1,
  focused: false,
  agent_session: { agent: "pi", kind: "path", source: "fixture", value: "/fixture.jsonl" },
};
const text =
  "Here is the plan:\n\n" +
  "Use the full message width on every line. ".repeat(8) +
  "\n\n```js\nconst copied = true;\n```";
const snapshot = {
  type: "snapshot",
  version: 2,
  identity: {
    runtime: "a0000000-0000-4000-8000-000000000001",
    pid: 1,
    processStart: "1",
    pane: agent.pane_id,
    herdrSocket: "/fixture.sock",
    sessionId: "copy-fixture",
    sessionFile: "/fixture.jsonl",
  },
  epoch: "a0000000-0000-4000-8000-000000000002",
  seq: 1,
  busy: false,
  sendPending: false,
  truncated: false,
  status: { cwd: "/fixture", totalTokens: 0, cost: 0 },
  messages: [
    { id: "u", role: "user", text: "Summarize the plan.", timestamp: 0 },
    { id: "a", role: "assistant", text, timestamp: 0 },
    { id: "short", role: "assistant", text: "OK" },
  ],
};
const server = createHttpServer(
  { getDashboard: async () => ({ agents: [], tabs: [], workspaces: [] }) },
  resolve("dist"),
  {},
);
await new Promise((done) => server.listen(0, "127.0.0.1", done));
try {
  for (const [engineName, engine] of [
    ["chromium", chromium],
    ["webkit", webkit],
  ]) {
    const browser = await engine.launch({ headless: true });
    try {
      for (const width of [320, 834, 1440]) {
        const page = await browser.newPage({
          viewport: { width, height: 1000 },
          hasTouch: width < 1000,
          serviceWorkers: "block",
        });
        const errors = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.addInitScript((initial) => {
          Object.defineProperty(navigator, "clipboard", {
            configurable: true,
            value: {
              writeText: async (value) => {
                window.copiedText = value;
              },
            },
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
        }, snapshot);
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
              : route.fulfill({ status: 503, json: { error: "Synthetic fixture" } }),
        );
        await page.goto(`http://127.0.0.1:${server.address().port}`);
        await page.getByRole("tab", { name: "Agents", exact: true }).click();
        await page.getByTestId("pane-row").click();
        const article = page.locator('[data-message-id="a"]');
        const bubble = article.locator('[data-ui="chat-message-bubble"]');
        const copy = article
          .locator("header")
          .getByRole("button", { name: "Copy message", exact: true });
        await copy.waitFor();
        for (const id of ["a", "u", "short"]) {
          const geometry = await page.locator(`[data-message-id="${id}"]`).evaluate((element) => {
            const bubble = element.querySelector('[data-ui="chat-message-bubble"]');
            const text = bubble.querySelector('[data-ui="chat-message-text"]');
            const button = element.querySelector('header [aria-label="Copy message"]');
            const time = element.querySelector("time");
            const b = button.getBoundingClientRect();
            const t = text.getBoundingClientRect();
            const e = bubble.getBoundingClientRect();
            const date = time?.getBoundingClientRect();
            const sender = element
              .querySelector('[data-ui="chat-message-sender"]')
              .getBoundingClientRect();
            return {
              right: b.right - e.right,
              neighborGap: b.left - (date ?? sender).right,
              above: e.top - b.bottom,
              inset: e.right - t.right,
              leftInset: t.left - e.left,
              overflow: element.scrollWidth - element.clientWidth,
              sameRow: date ? Math.abs((b.top + b.bottom - date.top - date.bottom) / 2) : 0,
              bubbleControls: bubble.querySelectorAll('[aria-label="Copy message"]').length,
            };
          });
          if (id === "u") {
            assert.ok(Math.abs(geometry.right) <= 1, "User copy remains right-aligned");
          }
          assert.ok(
            Math.abs(geometry.neighborGap - 8) <= 1,
            "Copy sits directly after the timestamp, or sender when no timestamp exists",
          );
          assert.ok(geometry.above >= 7, "Copy stays above the bubble");
          assert.ok(geometry.sameRow <= 1, "Copy and timestamp share a row");
          assert.ok(
            Math.abs(geometry.inset - geometry.leftInset) <= 1,
            "Text has equal padding; no reserved strip",
          );
          assert.ok(geometry.inset <= 17, "Only normal bubble padding remains");
          assert.equal(geometry.bubbleControls, 0);
          assert.ok(geometry.overflow <= 1, "Messages must not overflow on narrow phones");
        }
        await copy.click();
        await article.getByRole("button", { name: "Message copied", exact: true }).waitFor();
        assert.equal(await page.evaluate(() => window.copiedText), text);
        const before = await bubble.boundingBox();
        await article.getByRole("button", { name: "Copy message", exact: true }).waitFor();
        assert.deepEqual(await bubble.boundingBox(), before, "Confirmation must not shift layout");
        assert.deepEqual(errors, []);
        console.log(
          `${engineName} ${width}px: copy beside timestamp, unchanged user alignment, full text width, stable confirmation passed`,
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
