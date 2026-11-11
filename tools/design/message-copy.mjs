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
  "Reserve the right side on every line. ".repeat(8) +
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
        const copy = bubble.getByRole("button", { name: "Copy message", exact: true });
        await copy.waitFor();
        assert.equal(await article.locator("header button").count(), 0);
        const geometry = await bubble.evaluate((element) => {
          const text = element.querySelector('[data-ui="chat-message-text"]');
          const button = element.querySelector('[aria-label="Copy message"]');
          const b = button.getBoundingClientRect();
          const t = text.getBoundingClientRect();
          const e = element.getBoundingClientRect();
          return {
            gap: b.left - t.right,
            inset: e.right - b.right,
            overflow: element.scrollWidth - element.clientWidth,
            top: b.top - e.top,
            textHeight: t.height,
            buttonHeight: b.height,
          };
        });
        assert.ok(geometry.gap >= 7, "Entire text column must clear the copy strip");
        assert.ok(geometry.inset >= 10, "Icon stays inside the bubble");
        assert.ok(geometry.top >= 10 && geometry.top <= 20, "Icon sits at the top");
        assert.ok(geometry.textHeight > geometry.buttonHeight * 2, "Exercise multiline content");
        assert.ok(geometry.overflow <= 1, "Bubble must not overflow on narrow phones");
        await copy.click();
        await bubble.getByRole("button", { name: "Message copied", exact: true }).waitFor();
        assert.equal(await page.evaluate(() => window.copiedText), text);
        const before = await bubble.boundingBox();
        await bubble.getByRole("button", { name: "Copy message", exact: true }).waitFor();
        assert.deepEqual(await bubble.boundingBox(), before, "Confirmation must not shift layout");
        assert.deepEqual(errors, []);
        console.log(
          `${engineName} ${width}px: reserved strip, exact copy, stable confirmation passed`,
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
