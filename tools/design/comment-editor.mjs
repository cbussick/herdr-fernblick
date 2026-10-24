// Focused layout checks with synthetic API/SSE fixtures; never controls a real agent.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
const { chromium, webkit } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.argv[2] || "http://127.0.0.1:5286";
const out = "design-gallery/comment-editor";
await fs.mkdir(out, { recursive: true });
const target = {
  runtime: "a0000000-0000-4000-8000-000000000001",
  epoch: "a0000000-0000-4000-8000-000000000002",
  sessionId: "comment-editor-fixture",
};
const quote = "Keep the conversation readable on small screens.";
const snapshot = {
  type: "snapshot",
  version: 2,
  identity: {
    ...target,
    pid: 123,
    processStart: "fixture",
    pane: "w1:p1",
    herdrSocket: "/fixtures/herdr.sock",
    sessionFile: "/fixtures/session.jsonl",
  },
  epoch: target.epoch,
  seq: 1,
  busy: false,
  sendPending: false,
  truncated: false,
  messages: [{ id: "a1", role: "assistant", text: quote }],
  status: { cwd: "/projects/fernblick", totalTokens: 0, cost: 0 },
};
const agent = {
  agent: "pi",
  name: "comment-editor-fixture",
  pane_id: "w1:p1",
  tab_id: "w1:t1",
  tab_label: "Interface design",
  agent_status: "idle",
  agent_session: { agent: "pi", kind: "path", source: "fixture", value: "/fixtures/session.jsonl" },
  workspace_id: "w1",
  workspace_label: "Fernblick",
  cwd: "/projects/fernblick",
  focused: false,
  revision: 1,
};
for (const engine of [chromium, webkit]) {
  const browser = await engine.launch({ headless: true });
  try {
    for (const { touch, ...viewport } of [
      { width: 320, height: 568, touch: true },
      { width: 390, height: 844, touch: true },
      { width: 390, height: 360, touch: true },
      { width: 834, height: 1194, touch: true },
      { width: 1440, height: 1000, touch: false },
    ]) {
      // Start with the keyboard dismissed so background controls remain reachable.
      const initialViewport = { ...viewport, height: Math.max(568, viewport.height) };
      const page = await browser.newPage({
        viewport: initialViewport,
        hasTouch: touch,
        reducedMotion: "reduce",
      });
      const key = `${engine.name()}-${viewport.width}x${viewport.height}`;
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.addInitScript((initial) => {
        window.EventSource = class {
          constructor() {
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
          assert.equal(route.request().method(), "GET", "editing must never send an agent command");
          if (new URL(route.request().url()).pathname === "/api/agents")
            return route.fulfill({
              json: {
                agents: [agent],
                tabs: [],
                workspaces: [{ workspace_id: "w1", label: "Fernblick" }],
              },
            });
          return route.fulfill({ status: 503, json: { error: "Not part of this fixture" } });
        },
      );
      const dialog = page.locator('[data-ui="annotation-popover"]');
      const input = page.getByRole("textbox", { name: "Your comment" });
      const activate = (locator) => (touch ? locator.tap() : locator.click());
      async function checkLayout(state) {
        await dialog.waitFor();
        await page.evaluate(() => document.fonts.ready);
        await page.setViewportSize(viewport);
        await page.evaluate(
          () =>
            new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
        );
        const box = await dialog.boundingBox();
        assert.ok(box.x >= 12 && box.y >= 12, "keep the editor inset from the viewport");
        assert.ok(box.x + box.width <= viewport.width - 11);
        assert.ok(box.y + box.height <= viewport.height - 11);
        assert.equal(
          await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth),
          true,
        );
        const field = await input.boundingBox();
        const save = await dialog
          .getByRole("button", { name: /^(Add|Save) comment$/ })
          .boundingBox();
        assert.ok(save.y >= field.y + field.height + 8, "leave breathing room before the actions");
        assert.ok(save.height >= 44);
        assert.ok(
          save.y + save.height <= box.y + box.height,
          "save stays visible at keyboard height",
        );
        const hint = dialog.getByText("Enter to save · Shift + Enter for a new line", {
          exact: true,
        });
        if (await hint.count()) assert.equal(await hint.isVisible(), !touch);
        const remove = dialog.getByRole("button", { name: "Delete comment", exact: true });
        if (await remove.count()) {
          const secondary = await remove.boundingBox();
          assert.ok(secondary.x + secondary.width + 8 <= save.x);
          assert.ok(secondary.height >= 44);
        } else if (viewport.width <= 480) {
          assert.ok(
            Math.abs(save.width - field.width) <= 1,
            "phone primary action spans the field",
          );
        }
        await page.screenshot({ path: `${out}/${key}-${state}.png` });
        await page.setViewportSize(initialViewport);
      }
      try {
        await page.goto(base);
        await page.getByRole("tab", { name: "Agents", exact: true }).click();
        await page.getByTestId("pane-row").first().click();
        const source = page.locator('[data-annotation-source="a1"]');
        await source.waitFor();
        await source.evaluate((element, touch) => {
          element.dispatchEvent(
            new PointerEvent("pointerdown", {
              bubbles: true,
              pointerType: touch ? "touch" : "mouse",
            }),
          );
          const range = document.createRange();
          range.selectNodeContents(element);
          const selection = window.getSelection();
          selection.removeAllRanges();
          selection.addRange(range);
          element.dispatchEvent(
            new PointerEvent("pointerup", {
              bubbles: true,
              pointerType: touch ? "touch" : "mouse",
            }),
          );
        }, touch);
        await activate(page.getByRole("button", { name: "Comment", exact: true }));
        assert.equal(await input.evaluate((element) => element === document.activeElement), true);
        assert.equal(await dialog.locator("blockquote").textContent(), quote);
        await input.fill("Keep the status beside the name.");
        await checkLayout("passage");
        await activate(dialog.getByRole("button", { name: "Add comment", exact: true }));
        await dialog.waitFor({ state: "hidden" });
        await activate(page.getByRole("button", { name: "Add general comment", exact: true }));
        assert.equal(await page.getByText("Not tied to a passage.", { exact: true }).count(), 0);
        assert.equal(await dialog.locator("blockquote").count(), 0);
        assert.equal(
          await dialog.getByRole("button", { name: "Add comment", exact: true }).isDisabled(),
          true,
        );
        await checkLayout("general");
        await input.fill("Also preserve keyboard navigation.");
        await input.press("Enter");
        await dialog.waitFor({ state: "hidden" });
        await activate(source.locator("mark").first());
        await checkLayout("edit");
        await input.fill("Keep the status visible.");
        await activate(dialog.getByRole("button", { name: "Save comment", exact: true }));
        await dialog.waitFor({ state: "hidden" });
        await activate(source.locator("mark").first());
        assert.equal(await input.inputValue(), "Keep the status visible.");
        await activate(dialog.getByRole("button", { name: "Delete comment", exact: true }));
        await dialog.waitFor({ state: "hidden" });
        await activate(page.getByRole("button", { name: /1 pending comment/ }));
        await activate(page.getByRole("button", { name: /Edit text of comment 1:/ }));
        await checkLayout("edit-general");
        await input.press("Escape");
        await dialog.waitFor({ state: "hidden" });
        assert.deepEqual(errors, []);
        console.log(`${key}: comment editor passed`);
      } catch (error) {
        await page.screenshot({ path: `${out}/${key}-failure.png` });
        throw error;
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }
}
