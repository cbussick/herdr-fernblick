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
  status: {
    cwd: "/fixture",
    totalTokens: 0,
    cost: 0,
    footerLines: [
      "gpt-fixture high · Context 11% used · weekly 76% left (reset Thu 1:56) · ~/fixture · main",
      "↑59k ↓5.5k R1.2M CH99.8% $0.297 10.9%/500k (fixture)",
    ],
  },
};
for (const [engine, type] of [
  ["chromium", chromium],
  ["webkit", webkit],
]) {
  const browser = await type.launch({ headless: true, ignoreDefaultArgs: ["--hide-scrollbars"] });
  try {
    for (const [device, width, height, expandedHeight] of [
      ["tablet", 834, 900, 1194],
      ["phone", 390, 440, 844],
      ["pixel", 393, 427, 727],
    ]) {
      if (process.env.SCROLL_CASE && process.env.SCROLL_CASE !== device) continue;
      if (process.env.SCROLL_ENGINE && process.env.SCROLL_ENGINE !== engine) continue;
      const page = await browser.newPage({
        viewport: { width, height },
        hasTouch: device !== "tablet",
        isMobile: device !== "tablet",
        deviceScaleFactor: device === "pixel" ? 2.75 : device === "phone" ? 3 : 1,
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
      const send = () => {
        const button = page.getByRole("button", { name: "Send message", exact: true });
        return device === "tablet" ? button.click() : button.tap();
      };
      // Mobile WebKit has no wheel API. Model the touch intent, then let the
      // browser deliver real scroll events for the corresponding scrollTop change.
      const scroll = (delta) =>
        engine === "webkit" && device !== "tablet"
          ? transcript.evaluate((el, y) => {
              const touch = (type, clientY) => {
                const event = new Event(type, { bubbles: true });
                Object.defineProperty(event, "touches", { value: [{ clientY }] });
                el.dispatchEvent(event);
              };
              touch("touchstart", 100);
              touch("touchmove", 100 - Math.sign(y) * 20);
              el.scrollBy(0, y);
            }, delta)
          : page.mouse.wheel(0, delta);
      const geometry = () =>
        transcript.evaluate((el) => ({
          top: el.scrollTop,
          height: el.clientHeight,
          rectHeight: el.getBoundingClientRect().height,
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
      if (device === "tablet" && engine === "chromium") {
        const box = await transcript.boundingBox();
        await page.mouse.click(box.x + box.width - 5, box.y + 10);
        // Native scrollbar track clicks may animate independently of CSS scroll-behavior.
        await page.waitForTimeout(500);
        const reading = await geometry();
        assert.ok(reading.gap > 1, `${engine}: scrollbar click must pause following`);
        await stream();
        assert.equal((await geometry()).top, reading.top, "scrollbar reader stays paused");
        await transcript.hover();
        await scroll(100000);
        await bottom("return after scrollbar reading");
        await settle();
      }
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
      await send();
      for (let i = 0; i < 100 && commands.length < 1; i++) await page.waitForTimeout(20);
      assert.equal(commands.length, 1);
      await bottom("send from a paused transcript must resume following immediately");
      if (device === "pixel") {
        await page.evaluate(
          (next) => {
            window.fixtureStream.onmessage({ data: JSON.stringify(next) });
          },
          {
            ...snapshot,
            seq: ++seq,
            busy: false,
            sendPending: true,
            messages: [
              ...snapshot.messages,
              { id: "u1", role: "user", text: "A new turn from the composer" },
            ],
          },
        );
        await transcript.locator('[data-message-id="u1"]').waitFor();
        await bottom("local message echo before keyboard/footer changes");
        await page.evaluate(() => {
          const footer = document.querySelector('[data-testid="pi-session-status"]');
          const transcript = document.querySelector('[data-testid="chat-transcript"]');
          footer.style.display = "none";
          // Force browser layout/clamping between two geometry changes, as can
          // happen while the keyboard and mirrored session footer update.
          void transcript.scrollTop;
          footer.style.display = "";
        });
        await settle();
        await bottom("send stays pinned through successive geometry changes");
      }
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
      await send();
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
      // Keyboard reading must pause following even during later streamed output.
      await transcript.focus();
      await page.keyboard.press("PageUp");
      await page.waitForTimeout(500);
      const keyboardReading = await geometry();
      assert.ok(keyboardReading.gap > 1, "PageUp pauses following");
      messages[2].text += "Output while keyboard reading.\n\n".repeat(3);
      await publish(true);
      await settle();
      assert.equal((await geometry()).top, keyboardReading.top);
      await transcript.hover();
      await scroll(100000);
      await bottom("return after keyboard reading");
      await settle();
      if (engine === "chromium" && device !== "tablet") {
        // Real browser touch input, not a synthetic DOM event or mouse wheel.
        const cdp = await page.context().newCDPSession(page);
        const box = await transcript.boundingBox();
        const point = { x: box.x + box.width / 2, y: box.y + box.height / 3 };
        await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
        for (let i = 1; i <= 8; i++) {
          await cdp.send("Input.dispatchTouchEvent", {
            type: "touchMove",
            touchPoints: [{ ...point, y: point.y + i * 10 }],
          });
          await page.waitForTimeout(16);
        }
        // Hold before lifting so inertial scrolling does not race the assertion.
        await page.waitForTimeout(150);
        await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
        await settle();
        const touchReading = await geometry();
        assert.ok(touchReading.gap > 1, "upward reader touch scroll pauses following");
        messages[2].text += "Output while touch reading.\n\n".repeat(3);
        await publish(true);
        await settle();
        assert.equal((await geometry()).top, touchReading.top);
        await cdp.detach();
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
