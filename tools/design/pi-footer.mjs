// Synthetic browser check. All API/SSE traffic is intercepted; no live agent is controlled.
// PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node tools/design/pi-footer.mjs URL
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
const { chromium, webkit } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.argv[2] || "http://127.0.0.1:5186";
const output = "design-gallery/pi-footer";
await mkdir(output, { recursive: true });
const agent = {
  agent: "pi",
  name: "footer-fixture",
  pane_id: "w1:p1",
  tab_id: "w1:t1",
  workspace_id: "w1",
  workspace_label: "Fernblick",
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
    pid: 1,
    processStart: "1",
    pane: agent.pane_id,
    herdrSocket: "/fixture.sock",
    sessionId: "footer",
    sessionFile: "/fixture.jsonl",
  },
  epoch: "a0000000-0000-4000-8000-000000000002",
  seq: 1,
  busy: false,
  sendPending: false,
  truncated: false,
  messages: [{ id: "m1", role: "assistant", text: "Synthetic footer preview." }],
  status: {
    cwd: "/fallback",
    model: "fallback-model",
    provider: "fallback",
    totalTokens: 0,
    cost: 0,
    footerLines: [
      "\x1b[22m\x1b[38;2;246;226;183;49mgpt-5.4 high\x1b[2m\x1b[39;49m · \x1b[22m\x1b[38;2;242;181;144mContext 23% used\x1b[2m\x1b[39;49m · \x1b[22m\x1b[38;2;233;144;169m5h 79% left (reset 18:00) · weekly 58% left (reset Tue 18:00)\x1b[2m\x1b[39;49m · \x1b[22m\x1b[38;2;171;223;167m~/project/long-directory\x1b[2m\x1b[39;49m · \x1b[22m\x1b[38;2;143;179;239mfeature/mirror-footer\x1b[0m",
      "\x1b[2mMirror Pi footer ↑120k ↓10k R30k W5k CH17.6% $1.234 23.4%/200k (openai-codex) <img src=x onerror=alert(1)>\x1b[0m",
    ],
  },
};
for (const [engine, browserType] of [
  ["chromium", chromium],
  ["webkit", webkit],
]) {
  const browser = await browserType.launch({ headless: true });
  try {
    for (const [name, width, height] of [
      ["small-phone", 320, 568],
      ["phone", 390, 844],
      ["keyboard-height", 390, 440],
      ["ipad", 834, 1194],
      ["desktop", 1440, 1000],
    ]) {
      const page = await browser.newPage({ viewport: { width, height }, reducedMotion: "reduce" });
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.addInitScript((initial) => {
        window.EventSource = class {
          constructor() {
            window.fixtureStream = this;
            this.timer = setTimeout(() => this.onmessage?.({ data: JSON.stringify(initial) }), 30);
          }
          close() {
            clearTimeout(this.timer);
          }
        };
      }, snapshot);
      await page.route(
        (url) => url.pathname.startsWith("/api/"),
        async (route) => {
          if (new URL(route.request().url()).pathname === "/api/agents")
            return route.fulfill({
              json: {
                agents: [agent],
                workspaces: [{ workspace_id: "w1", label: "Fernblick" }],
                tabs: [],
              },
            });
          throw new Error(
            `Unexpected API call: ${route.request().method()} ${route.request().url()}`,
          );
        },
      );
      await page.goto(base);
      await page.getByRole("tab", { name: "Agents", exact: true }).click();
      await page.getByTestId("pane-row").click();
      const footer = page.getByTestId("pi-session-status");
      await footer.waitFor();
      assert.equal(await page.getByTestId("pi-footer-line").count(), 2);
      assert.ok((await footer.innerText()).includes("weekly 58% left"));
      assert.ok((await footer.innerText()).includes("<img src=x onerror=alert(1)>"));
      assert.equal(await footer.locator("img, a, script").count(), 0);
      assert.equal(
        await footer
          .locator("span")
          .first()
          .evaluate((e) => getComputedStyle(e).color),
        "rgb(246, 226, 183)",
      );
      assert.equal(
        await footer
          .locator("[data-dim]")
          .first()
          .evaluate((e) => getComputedStyle(e).opacity),
        "0.65",
      );
      assert.equal(await footer.evaluate((e) => e.scrollWidth <= e.clientWidth + 1), true);
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
      );
      const composer = await page.getByRole("textbox").boundingBox();
      assert.ok(composer && composer.y >= 0 && composer.y + composer.height <= height);
      await page.screenshot({ path: `${output}/${engine}-${name}.png`, fullPage: true });
      // A patch without footerLines must clear the old full footer, not merge it.
      const { messages: _messages, type: _type, ...metadata } = snapshot;
      await page.evaluate(
        (frame) => window.fixtureStream.onmessage({ data: JSON.stringify(frame) }),
        {
          ...metadata,
          type: "patch",
          baseSeq: 1,
          seq: 2,
          upsert: [],
          status: { ...snapshot.status, footerLines: undefined },
        },
      );
      await page.getByText(/0 displayed tokens/).waitFor();
      assert.equal(await page.getByTestId("pi-footer-line").count(), 0);
      // Extreme but valid single segments wrap and scroll vertically, without displacing the composer.
      await page.evaluate(
        (frame) => window.fixtureStream.onmessage({ data: JSON.stringify(frame) }),
        {
          ...metadata,
          type: "patch",
          baseSeq: 2,
          seq: 3,
          upsert: [],
          status: { ...snapshot.status, footerLines: ["x".repeat(8192), "second line"] },
        },
      );
      await page.getByTestId("pi-footer-line").first().waitFor();
      assert.equal(await footer.evaluate((e) => e.scrollWidth <= e.clientWidth + 1), true);
      assert.equal(await footer.evaluate((e) => e.scrollHeight > e.clientHeight), true);
      const freshComposer = await page.getByRole("textbox").boundingBox();
      assert.ok(freshComposer && freshComposer.y + freshComposer.height <= height);
      assert.deepEqual(errors, []);
      await page.close();
      console.log(`${engine} ${name}: passed`);
    }
  } finally {
    await browser.close();
  }
}
