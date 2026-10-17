// Synthetic scroll regression: all API/SSE traffic is intercepted; no live agents are controlled.
// PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node tools/design/transcript-follow.mjs URL
import assert from "node:assert/strict";
const { chromium, webkit } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.argv[2] || "http://127.0.0.1:5207";
const agent = {
  agent: "pi",
  name: "scroll-fixture",
  pane_id: "w1:p1",
  tab_id: "w1:t1",
  tab_label: "Scroll fixture",
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
    sessionId: "scroll-fixture",
    sessionFile: "/fixture.jsonl",
  },
  epoch: "a0000000-0000-4000-8000-000000000002",
  seq: 1,
  busy: true,
  sendPending: false,
  truncated: false,
  messages: [{ id: "m1", role: "assistant", text: "Streaming paragraph.\n\n".repeat(100) }],
  status: { cwd: "/fixture", totalTokens: 0, cost: 0 },
};
for (const [engine, type] of [
  ["chromium", chromium],
  ["webkit", webkit],
]) {
  const browser = await type.launch({ headless: true });
  try {
    for (const [device, width, height, expandedHeight] of [
      ["tablet", 834, 900, 1194],
      ["phone", 390, 440, 844],
    ]) {
      const page = await browser.newPage({
        viewport: { width, height },
        hasTouch: true,
        isMobile: device === "phone",
        deviceScaleFactor: device === "phone" ? 3 : 1,
      });
      const errors = [];
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
        (route) => {
          const path = new URL(route.request().url()).pathname;
          if (path === "/api/agents")
            return route.fulfill({
              json: {
                agents: [agent],
                workspaces: [{ workspace_id: "w1", label: "Fernblick" }],
                tabs: [],
              },
            });
          if (path.endsWith("/prompt")) {
            commands.push(route);
            return;
          }
          return route.fulfill({ status: 503, json: { error: "Unexpected fixture request" } });
        },
      );
      await page.goto(base);
      await page.getByRole("tab", { name: "Agents", exact: true }).click();
      await page.getByTestId("pane-row").click();
      const transcript = page.getByTestId("chat-transcript");
      await transcript.locator('[data-message-id="m1"]').waitFor();
      const settle = () => page.waitForTimeout(100);
      // Mobile WebKit has no wheel input; change scrollTop and use its real scroll events.
      const scroll = (delta) =>
        engine === "webkit" && device === "phone"
          ? transcript.evaluate((el, y) => el.scrollBy(0, y), delta)
          : page.mouse.wheel(0, delta);
      const geometry = () =>
        transcript.evaluate((el) => ({
          top: el.scrollTop,
          height: el.clientHeight,
          gap: el.scrollHeight - el.clientHeight - el.scrollTop,
        }));
      const bottom = async (label) => {
        await page
          .waitForFunction(
            () => {
              const el = document.querySelector('[data-testid="chat-transcript"]');
              return el && Math.abs(el.scrollHeight - el.clientHeight - el.scrollTop) <= 1;
            },
            null,
            { timeout: 3000 },
          )
          .catch(() => {});
        const state = await geometry();
        assert.ok(
          Math.abs(state.gap) <= 1,
          `${engine}/${device} ${label}: ${JSON.stringify(state)}`,
        );
      };
      let seq = 1;
      const stream = async () => {
        seq++;
        await page.evaluate(
          (next) => {
            window.fixtureStream.onmessage({ data: JSON.stringify(next) });
          },
          {
            ...snapshot,
            seq,
            messages: [{ ...snapshot.messages[0], text: snapshot.messages[0].text.repeat(seq) }],
          },
        );
        await settle();
      };
      await bottom("initial follow");
      // A larger viewport clamps scrollTop before the deferred ResizeObserver alignment.
      await page.setViewportSize({ width, height: expandedHeight });
      await settle();
      await stream();
      await bottom("follow after browser resize without reader input");
      // Real reader input must still pause following immediately.
      await transcript.hover();
      await scroll(-12);
      await settle();
      const paused = await geometry();
      assert.ok(paused.gap > 1, "reader scrolled above the bottom");
      await stream();
      assert.equal((await geometry()).top, paused.top, "streaming must not pull the reader down");
      await scroll(100000);
      await bottom("reader returns to bottom");
      await settle();
      await stream();
      await bottom("following resumes");
      // A deliberate send should leave reading mode immediately, not wait for a Pi echo.
      await page.evaluate(
        (next) => {
          window.fixtureStream.onmessage({ data: JSON.stringify(next) });
        },
        { ...snapshot, seq: ++seq, busy: false },
      );
      await transcript.hover();
      await scroll(-120);
      await settle();
      assert.ok((await geometry()).gap > 1, "reader is above the bottom before sending");
      await page.locator("#agent-prompt").fill("A new turn from the composer");
      await page.getByRole("button", { name: "Send message", exact: true }).click();
      for (let i = 0; i < 100 && commands.length < 1; i++) await page.waitForTimeout(20);
      assert.equal(commands.length, 1);
      await bottom("send from a paused transcript must resume following immediately");
      const messages = [
        ...snapshot.messages,
        { id: "u1", role: "user", text: "A new turn from the composer" },
        { id: "a1", role: "assistant", text: "A streaming reply.\n\n".repeat(30) },
      ];
      const publish = (busy) =>
        page.evaluate(
          (next) => {
            window.fixtureStream.onmessage({ data: JSON.stringify(next) });
          },
          { ...snapshot, seq: ++seq, busy, messages },
        );
      await publish(true);
      await transcript.locator('[data-message-id="a1"]').waitFor();
      await bottom("echo and reply after sending keep following");
      await transcript.hover();
      await scroll(-12);
      await settle();
      const reading = await geometry();
      assert.ok(reading.gap > 1);
      await commands[0].fulfill({
        json: {
          type: "ack",
          id: commands[0].request().postDataJSON().requestId,
          outcome: "invoked",
        },
      });
      await settle();
      assert.equal((await geometry()).top, reading.top, "late ACK must not reset reading mode");
      messages[2].text += "More streamed output.\n\n".repeat(30);
      await publish(false);
      await settle();
      assert.equal(
        (await geometry()).top,
        reading.top,
        "streaming after a send still respects reading mode",
      );
      // A subsequent keyboard submission is a distinct follow request.
      await page.locator("#agent-prompt").fill("Another turn using the keyboard");
      await page.getByRole("button", { name: "Send message", exact: true }).focus();
      await page.keyboard.press("Enter");
      for (let i = 0; i < 100 && commands.length < 2; i++) await page.waitForTimeout(20);
      assert.equal(commands.length, 2);
      await bottom("keyboard send also resumes following immediately");
      await commands[1].fulfill({
        json: {
          type: "ack",
          id: commands[1].request().postDataJSON().requestId,
          outcome: "invoked",
        },
      });
      await page.locator("#agent-prompt").fill("A longer phone message\n".repeat(8));
      await page.setViewportSize({ width, height });
      await settle();
      await page.getByRole("button", { name: "Send message", exact: true }).click();
      for (let i = 0; i < 100 && commands.length < 3; i++) await page.waitForTimeout(20);
      assert.equal(commands.length, 3);
      await bottom("multiline send with keyboard open");
      await commands[2].fulfill({
        json: {
          type: "ack",
          id: commands[2].request().postDataJSON().requestId,
          outcome: "invoked",
        },
      });
      await settle();
      await bottom("multiline draft cleared after ACK");
      for (let step = 1; step <= 8; step++) {
        await page.setViewportSize({
          width,
          height: height + Math.round(((expandedHeight - height) * step) / 8),
        });
        await settle();
        messages[2].text += "Output while keyboard closes.\n\n".repeat(3);
        await publish(true);
        await settle();
        await bottom(`keyboard dismissal step ${step}`);
      }
      assert.deepEqual(errors, []);
      console.log(
        `${engine}/${device}: resize, reader pause/resume, click/keyboard sends, multiline ACK, echo and keyboard dismissal passed`,
      );
      await page.close();
    }
  } finally {
    await browser.close();
  }
}
