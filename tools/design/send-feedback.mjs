// Synthetic send regression: all API/SSE traffic is intercepted; no live agents are controlled.
// PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node tools/design/send-feedback.mjs URL
import assert from "node:assert/strict";
import fs from "node:fs/promises";
const { chromium, webkit } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.argv[2] || "http://127.0.0.1:5191";
const output = "design-gallery/send-feedback";
await fs.mkdir(output, { recursive: true });
const agent = {
  agent: "pi",
  name: "send-fixture",
  pane_id: "w1:p1",
  tab_id: "w1:t1",
  tab_label: "Message feedback",
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
    sessionId: "send-fixture",
    sessionFile: "/fixture.jsonl",
  },
  epoch: "a0000000-0000-4000-8000-000000000002",
  seq: 1,
  busy: false,
  sendPending: false,
  truncated: false,
  messages: [{ id: "m1", role: "assistant", text: "Attach your images and send a message." }],
  status: { cwd: "/fixture", totalTokens: 0, cost: 0 },
};
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0D8AAAAASUVORK5CYII=",
  "base64",
);
for (const [engine, browserType] of [
  ["chromium", chromium],
  ["webkit", webkit],
]) {
  const browser = await browserType.launch({ headless: true });
  try {
    for (const [name, width, height] of [
      ["small-phone", 320, 568],
      ["keyboard-height", 390, 440],
      ["ipad", 834, 1194],
      ["desktop", 1440, 1000],
    ]) {
      const page = await browser.newPage({ viewport: { width, height }, reducedMotion: "reduce" });
      const errors = [];
      const uploads = [];
      const commands = [];
      page.on("pageerror", (error) => errors.push(error.message));
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
          const path = new URL(route.request().url()).pathname;
          if (path === "/api/agents")
            return route.fulfill({
              json: {
                agents: [agent],
                workspaces: [{ workspace_id: "w1", label: "Fernblick" }],
                tabs: [],
              },
            });
          if (path === "/api/uploads/images") {
            uploads.push(route);
            return;
          }
          if (path.endsWith("/prompt")) {
            commands.push(route);
            return;
          }
          return route.fulfill({ status: 503, json: { error: "Unexpected fixture request" } });
        },
      );
      const publish = async (state) =>
        page.evaluate((next) => {
          window.fixtureStream.onmessage({ data: JSON.stringify(next) });
        }, state);
      const waitForCount = async (items, count) => {
        for (let i = 0; i < 100 && items.length < count; i++) await page.waitForTimeout(20);
        assert.equal(items.length, count);
      };
      await page.goto(base);
      await page.getByRole("tab", { name: "Agents", exact: true }).click();
      await page.getByTestId("pane-row").click();
      const prompt = page.locator("#agent-prompt");
      const send = page.getByRole("button", { name: "Send message", exact: true });
      const status = page.getByTestId("chat-activity");
      const composer = page.locator("form").filter({ has: prompt });
      let composerBox;
      const checkComposer = async () => {
        if (!composerBox) return;
        const box = await composer.boundingBox();
        for (const key of ["x", "y", "width", "height"])
          assert.ok(
            Math.abs(box[key] - composerBox[key]) < 1,
            `progress must not shift composer ${key}`,
          );
      };
      const checkStatus = async (text) => {
        await page.getByRole("status").filter({ hasText: text }).waitFor();
        assert.equal(await status.locator('[data-ui="status-indicator"]').innerText(), text);
        assert.equal(
          await status.evaluate((el) => !!el.closest('[data-testid="chat-transcript"]')),
          true,
        );
        assert.equal(await composer.locator('[role="status"]').count(), 0);
        await checkComposer();
        assert.equal(
          await status.evaluate((el) => !!el.closest('[aria-busy="true"]')),
          false,
          "a busy ancestor must not defer live announcements",
        );
        const box = await status.boundingBox();
        assert.ok(
          box && box.y >= 0 && box.y + box.height <= height,
          "feedback remains in viewport",
        );
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          true,
        );
      };
      await prompt.fill("Compare these two images");
      await page.locator('input[type="file"]').setInputFiles([
        { name: "one.png", mimeType: "image/png", buffer: png },
        { name: "two.png", mimeType: "image/png", buffer: png },
      ]);
      composerBox = await composer.boundingBox();
      await send.click();
      await waitForCount(uploads, 1);
      await checkStatus("Uploading image 1 of 2…");
      await status.evaluate((el) => {
        window.savedActivity = el;
      });
      assert.equal(await status.getByRole("button").count(), 0);
      assert.equal(commands.length, 0);
      assert.equal(await prompt.isDisabled(), true);
      await uploads[0].fulfill({
        json: {
          id: "b0000000-0000-4000-8000-000000000001.png",
          path: "/fixture/one.png",
          url: "/api/uploads/one.png",
        },
      });
      await waitForCount(uploads, 2);
      await checkStatus("Uploading image 2 of 2…");
      await page.screenshot({ path: `${output}/${engine}-${name}-upload.png` });
      await uploads[1].fulfill({
        json: {
          id: "b0000000-0000-4000-8000-000000000002.png",
          path: "/fixture/two.png",
          url: "/api/uploads/two.png",
        },
      });
      await waitForCount(commands, 1);
      await checkStatus("Sending message…");
      assert.equal(await status.evaluate((el) => el === window.savedActivity), true);
      assert.equal(commands[0].request().postDataJSON().attachments.length, 2);
      await publish({ ...snapshot, seq: 2, sendPending: true });
      // Clearing acknowledged attachments naturally changes draft height; progress must not.
      composerBox = undefined;
      await commands[0].fulfill({
        json: {
          type: "ack",
          id: commands[0].request().postDataJSON().requestId,
          outcome: "invoked",
        },
      });
      await checkStatus("Waiting for agent activity…");
      assert.equal(await status.evaluate((el) => el === window.savedActivity), true);
      assert.equal(await status.getByRole("button").count(), 0);
      composerBox = await composer.boundingBox();
      assert.equal(await prompt.inputValue(), "");
      assert.equal(await prompt.isDisabled(), false);
      await publish({ ...snapshot, seq: 3, busy: true });
      await checkStatus("Working");
      assert.equal(await status.evaluate((el) => el === window.savedActivity), true);
      assert.equal(await status.getByRole("button", { name: "Stop", exact: true }).count(), 1);
      await publish({ ...snapshot, seq: 4 });
      await status.waitFor({ state: "detached" });
      await checkComposer();
      await prompt.fill("A text-only message");
      composerBox = await composer.boundingBox();
      await send.click();
      await waitForCount(commands, 2);
      await checkStatus("Sending message…");
      await commands[1].fulfill({ status: 503, json: { error: "Delivery uncertain" } });
      await page.getByRole("alert").filter({ hasText: "Delivery uncertain" }).waitFor();
      assert.equal(await status.count(), 0);
      assert.equal(await prompt.inputValue(), "A text-only message");
      assert.equal(commands.length, 2, "uncertain sends are not automatically replayed");
      assert.deepEqual(errors, []);
      await page.close();
      console.log(`${engine} ${name}: send feedback passed`);
    }
  } finally {
    await browser.close();
  }
}
