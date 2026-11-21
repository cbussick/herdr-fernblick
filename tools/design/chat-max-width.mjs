import { report } from "../report.mjs";
// Synthetic-only chat layout coverage. No real Herdr/Pi sessions are contacted.
// Run after npm run build: node tools/design/chat-max-width.mjs
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { resolve } from "node:path";
import { createHttpServer } from "../../dist-server/server/http/server.js";
const { chromium, webkit } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const output = "design-gallery/chat-max-width";
await fs.mkdir(output, { recursive: true });
const agent = {
  agent: "pi",
  pi_session_id: "layout-fixture",
  name: "layout-fixture",
  pane_id: "w1:p1",
  tab_id: "w1:t1",
  tab_label: "Readable chat on a wide screen",
  workspace_id: "w1",
  workspace_label: "Fernblick",
  agent_status: "working",
  revision: 1,
  focused: false,
  agent_session: { agent: "pi", kind: "path", source: "fixture", value: "/fixture.jsonl" },
};
const snapshot = {
  type: "snapshot",
  version: 2,
  identity: {
    runtime: "a0000000-0000-4000-8000-000000000001",
    pid: 1,
    processStart: "1",
    pane: agent.pane_id,
    herdrSocket: "/fixture.sock",
    sessionId: "layout-fixture",
    sessionFile: "/fixture.jsonl",
  },
  epoch: "a0000000-0000-4000-8000-000000000002",
  seq: 1,
  busy: true,
  sendPending: false,
  truncated: false,
  messages: [
    {
      id: "assistant",
      role: "assistant",
      text: "Messages and the textbox now share a centered max-width column. The background stays seamless, with no extra panel or border.",
    },
    { id: "user", role: "user", text: "Yes, that is what I had in mind." },
    {
      id: "tool",
      role: "tool",
      toolName: "bash",
      text: "Build and tests passed.\n" + "Wide tool output ".repeat(100),
    },
    {
      id: "structured",
      role: "assistant",
      text:
        "```ts\n" +
        "const value = 'long structured output stays inside the column';".repeat(30) +
        "\n```",
    },
  ],
  status: { cwd: "/fixture", totalTokens: 0, cost: 0, footerLines: ["Layout fixture · main"] },
};
const dashboard = {
  agents: [agent],
  tabs: [],
  workspaces: [{ workspace_id: "w1", label: "Fernblick" }],
};
const server = createHttpServer({ getDashboard: async () => dashboard }, resolve("dist"), {});
await new Promise((done) => {
  server.listen(0, "127.0.0.1", done);
});
try {
  for (const [engine, type] of [
    ["chromium", chromium],
    ["webkit", webkit],
  ]) {
    const browser = await type.launch({ headless: true, ignoreDefaultArgs: ["--hide-scrollbars"] });
    try {
      for (const width of [320, 390, 834, 1440, 2560]) {
        const page = await browser.newPage({
          viewport: { width, height: 1000 },
          serviceWorkers: "block",
        });
        const errors = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.addInitScript((initial) => {
          window.EventSource = class {
            constructor() {
              window.layoutStream = this;
              this.timer = setTimeout(
                () => this.onmessage?.({ data: JSON.stringify(initial) }),
                30,
              );
            }
            close() {
              clearTimeout(this.timer);
            }
          };
        }, snapshot);
        await page.route("**/api/**", async (route) => {
          const path = new URL(route.request().url()).pathname;
          assert.equal(route.request().method(), "GET");
          if (path === "/api/agents") {
            return route.fulfill({ json: dashboard });
          }
          if (path === "/api/sessions/layout-fixture") {
            return route.fulfill({ json: { agent, chat: null } });
          }
          return route.fulfill({ status: 503, json: { error: "Synthetic fixture" } });
        });
        await page.goto(`http://127.0.0.1:${server.address().port}`);
        await page.getByRole("tab", { name: "Agents", exact: true }).click();
        await page.getByTestId("pane-row").click();
        const transcript = page.getByTestId("chat-transcript");
        await transcript.locator('[data-message-id="structured"]').waitFor();
        await page.evaluate(() => document.fonts.ready);
        await page.getByTestId("chat-tool").locator("summary").click();
        const surface = page.locator('[data-ui="prompt-composer-surface"]');
        const composer = await surface.boundingBox();
        const tool = await page.getByTestId("chat-tool").boundingBox();
        const structured = await transcript.locator('[data-message-id="structured"]').boundingBox();
        const user = await transcript.locator('[data-message-id="user"]').boundingBox();
        const viewport = await transcript.boundingBox();
        assert(composer.width <= 1101, `Composer exceeds maximum: ${composer.width}`);
        assert(tool.width <= 1101, `Tool exceeds maximum: ${tool.width}`);
        assert(structured.width <= 1101, `Code exceeds maximum: ${structured.width}`);
        assert(user.x >= tool.x - 1 && user.x + user.width <= tool.x + tool.width + 1);
        if (width === 2560) {
          assert(Math.abs(composer.width - 1100) <= 1);
          assert(Math.abs(tool.width - composer.width) <= 1);
          assert(Math.abs(tool.x - composer.x) <= 1, "Tool and composer must share column edges");
          assert(
            viewport.width > composer.width + 400,
            "Scroll area should retain the wide gutters",
          );
        }
        const frame = await transcript.evaluate((node) => ({
          border: getComputedStyle(node).borderWidth,
          background: getComputedStyle(node).backgroundColor,
          width: node.clientWidth,
          scrollWidth: node.scrollWidth,
        }));
        assert.equal(frame.border, "0px");
        assert.equal(frame.background, "rgba(0, 0, 0, 0)");
        assert(
          frame.scrollWidth <= frame.width + 1,
          "Wide output must not overflow the transcript",
        );
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        for (const box of [composer, tool, user, structured]) {
          assert(box.x >= 0 && box.x + box.width <= width + 1);
        }
        await page.screenshot({ path: `${output}/${engine}-${width}.png` });
        // Column sizing must preserve streaming follow and the reader's paused position.
        const grow = async (seq) => {
          await page.evaluate(
            (next) => {
              window.layoutStream.onmessage({ data: JSON.stringify(next) });
            },
            {
              ...snapshot,
              seq,
              messages: [
                ...snapshot.messages,
                {
                  id: "streaming",
                  role: "assistant",
                  text: "Streaming paragraph.\n\n".repeat(100 * seq),
                },
              ],
            },
          );
        };
        await grow(2);
        await page.waitForFunction(() => {
          const node = document.querySelector('[data-testid="chat-transcript"]');
          return node && node.scrollHeight - node.clientHeight - node.scrollTop <= 1;
        });
        const pausedTop = await transcript.evaluate((node) => {
          node.dispatchEvent(new WheelEvent("wheel", { deltaY: -200, bubbles: true }));
          node.scrollTop = 100;
          return node.scrollTop;
        });
        await page.waitForTimeout(150);
        await grow(3);
        await page.waitForTimeout(150);
        const nextTop = await transcript.evaluate((node) => node.scrollTop);
        assert(
          Math.abs(nextTop - pausedTop) <= 1,
          `${engine}/${width}: paused ${pausedTop}, after stream ${nextTop}`,
        );
        // Widening chat must not constrain the full-width terminal view.
        await page.getByRole("button", { name: "Switch to Terminal view", exact: true }).click();
        const terminal = await page.getByTestId("output-panel").boundingBox();
        if (width === 2560) {
          assert(terminal.width > 1500);
        }
        assert.deepEqual(errors, []);
        await page.close();
      }
    } finally {
      await browser.close();
    }
  }
  report(
    "PASS: shared 1100px message/tool/composer column, seamless background, narrow screens, wide code, and unconstrained terminal in Chromium and WebKit.",
  );
} finally {
  await new Promise((done) => {
    server.close(done);
  });
}
