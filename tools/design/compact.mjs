// Synthetic compaction UI regression. All API/SSE traffic is intercepted; no live agents.
// PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node tools/design/compact.mjs URL
import assert from "node:assert/strict";
import fs from "node:fs/promises";
const { chromium, webkit } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.argv[2] || "http://127.0.0.1:5189";
const output = "design-gallery/compact";
await fs.mkdir(output, { recursive: true });
const target = {
  runtime: "a0000000-0000-4000-8000-000000000001",
  epoch: "a0000000-0000-4000-8000-000000000002",
  sessionId: "compact-fixture",
};
const agent = {
  agent: "pi",
  name: "compact-fixture",
  pane_id: "w1:p1",
  tab_id: "w1:t1",
  tab_label: "Interface design",
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
  capabilities: { skills: true, compact: true },
  identity: {
    ...target,
    pid: 1,
    processStart: "1",
    pane: agent.pane_id,
    herdrSocket: "/fixture.sock",
    sessionFile: "/fixture.jsonl",
  },
  epoch: target.epoch,
  seq: 1,
  busy: false,
  sendPending: false,
  truncated: false,
  messages: [
    {
      id: "m1",
      role: "assistant",
      text: "Older context can be summarized without clearing this conversation.",
    },
  ],
  status: { cwd: "/projects/fernblick", model: "Pi", provider: "fixture", totalTokens: 0, cost: 0 },
};
for (const [engine, type] of [
  ["chromium", chromium],
  ["webkit", webkit],
]) {
  const browser = await type.launch({ headless: true });
  try {
    for (const [name, width, height] of [
      ["small-phone", 320, 568],
      ["phone", 390, 844],
      ["keyboard", 390, 440],
      ["ipad", 834, 1194],
      ["ipad-landscape", 1194, 834],
      ["desktop", 1440, 1000],
    ]) {
      const page = await browser.newPage({ viewport: { width, height }, hasTouch: width < 1024 });
      const errors = [];
      let compactions = 0;
      let unexpected = 0;
      let release;
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
          const url = new URL(route.request().url());
          if (url.pathname === "/api/agents")
            return route.fulfill({
              json: {
                agents: [agent],
                workspaces: [{ workspace_id: "w1", label: "Fernblick" }],
                tabs: [],
              },
            });
          if (url.pathname.endsWith("/compact")) {
            compactions++;
            assert.deepEqual(route.request().postDataJSON(), { target });
            await new Promise((resolve) => {
              release = resolve;
            });
            return route.fulfill({ json: { type: "compacted", id: target.runtime, target } });
          }
          unexpected++;
          return route.fulfill({ status: 503, json: { error: "Unexpected fixture API request" } });
        },
      );
      await page.goto(base);
      await page.getByRole("tab", { name: "Agents", exact: true }).click();
      await page.getByTestId("pane-row").click();
      const draft = page.locator("#agent-prompt");
      await draft.fill("Keep this draft");
      await page.locator('input[type="file"]').setInputFiles({
        name: "fixture.png",
        mimeType: "image/png",
        buffer: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
          "base64",
        ),
      });
      const trigger = page.getByRole("button", { name: "More conversation actions", exact: true });
      const toolbar = trigger.locator("..");
      const menu = page.getByRole("menu", { name: "Conversation actions" });
      const compact = page.getByRole("menuitem", { name: "Compact conversation", exact: true });
      let state = structuredClone(snapshot);
      async function frame(patch) {
        state = { ...state, ...patch, seq: state.seq + 1 };
        await page.evaluate(
          (value) => window.fixtureStream.onmessage({ data: JSON.stringify(value) }),
          state,
        );
      }
      async function openMenu() {
        await trigger.click();
        await menu.waitFor();
      }
      async function chooseCompact() {
        await openMenu();
        await compact.click();
      }
      assert.equal(await toolbar.locator("..").locator("#agent-prompt").count(), 1);
      assert.equal(
        await trigger.evaluate((node) => node.previousElementSibling.textContent.trim()),
        "/ Skills",
      );
      assert.equal(
        await trigger.evaluate((node) => node.nextElementSibling.getAttribute("aria-label")),
        "Send message",
      );
      assert.equal(await page.getByRole("region", { name: "Conversation compaction" }).count(), 0);
      const triggerBox = await trigger.boundingBox();
      assert(
        triggerBox.width >= 44 && triggerBox.height >= 44,
        "More actions must retain a 44px target",
      );
      assert.equal(await trigger.getAttribute("aria-haspopup"), "menu");
      for (const button of await toolbar.getByRole("button").all()) {
        const bounds = await button.boundingBox();
        assert(bounds.width >= 44 && bounds.height >= 44, "Every toolbar target stays touch-sized");
        assert.equal(bounds.y, triggerBox.y, "Toolbar must remain one row");
        assert(
          bounds.x >= 0 && bounds.x + bounds.width <= width,
          "Toolbar controls must not be clipped",
        );
      }
      await page.screenshot({ path: `${output}/${engine}-${name}-toolbar.png` });
      await openMenu();
      assert.equal(await menu.getByRole("menuitem").count(), 1);
      assert.equal(await compact.evaluate((node) => node === document.activeElement), true);
      assert.equal(await menu.evaluate((node) => node.matches(":popover-open")), true);
      const bounds = await menu.boundingBox();
      assert(
        bounds.x >= 0 &&
          bounds.y >= 0 &&
          bounds.x + bounds.width <= width &&
          bounds.y + bounds.height <= height,
        "Menu fits viewport",
      );
      assert(bounds.y + bounds.height <= triggerBox.y, "Menu opens above toolbar");
      assert.equal(
        await compact.evaluate((node) => {
          const rect = node.getBoundingClientRect();
          return node.contains(
            document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2),
          );
        }),
        true,
        "Top-layer menu must not be clipped by the composer",
      );
      await page.screenshot({ path: `${output}/${engine}-${name}-menu.png` });
      if (name === "phone") {
        await page.setViewportSize({ width, height: 440 });
        await page.waitForFunction(() => {
          const box = document.querySelector('[role="menu"]').getBoundingClientRect();
          return box.y >= 0 && box.bottom <= innerHeight;
        });
        assert.equal(await menu.evaluate((node) => node.matches(":popover-open")), true);
        await page.screenshot({ path: `${output}/${engine}-menu-resize.png` });
        await page.setViewportSize({ width, height });
      }
      await compact.press("End");
      await compact.press("Home");
      await compact.press("ArrowUp");
      await compact.press("ArrowDown");
      assert.equal(await compact.evaluate((node) => node === document.activeElement), true);
      await compact.press("Escape");
      assert.equal(await menu.count(), 0);
      assert.equal(await trigger.evaluate((node) => node === document.activeElement), true);
      await trigger.press("ArrowUp");
      await compact.waitFor();
      await compact.press("Tab");
      assert.equal(await menu.count(), 0);
      await openMenu();
      await compact.press("Shift+Tab");
      assert.equal(await menu.count(), 0);
      assert.equal(
        await page
          .getByRole("button", { name: "Skills", exact: true })
          .evaluate((node) => node === document.activeElement),
        true,
      );
      await openMenu();
      await compact.press("Tab");
      assert.equal(
        await page
          .getByRole("button", { name: "Send message" })
          .evaluate((node) => node === document.activeElement),
        true,
      );
      await openMenu();
      await page.mouse.click(4, 4);
      await page.waitForFunction(() => !document.querySelector('[role="menu"]'));
      assert.equal(await trigger.getAttribute("aria-expanded"), "false");
      assert.equal(compactions, 0);
      await openMenu();
      await frame({ busy: true });
      await page.waitForFunction(
        () => document.querySelector('[role="menuitem"]')?.getAttribute("aria-disabled") === "true",
      );
      assert.match(await compact.innerText(), /idle/);
      await compact.evaluate((node) => node.click());
      assert.equal(compactions, 0);
      assert.equal(await page.getByRole("button", { name: "Compact now" }).count(), 0);
      await frame({ busy: false, capabilities: { skills: true } });
      await page.getByText("Run /reload in Pi to enable compaction.", { exact: true }).waitFor();
      await compact.evaluate((node) => node.click());
      assert.equal(compactions, 0);
      await frame({
        capabilities: { skills: true, compact: true },
        epoch: "a0000000-0000-4000-8000-000000000003",
      });
      await page.waitForFunction(() => !document.querySelector('[role="menu"]'));
      await openMenu();
      await page.evaluate(() =>
        window.fixtureStream.onmessage({
          data: JSON.stringify({ type: "unavailable", reason: "Fixture disconnected" }),
        }),
      );
      await page.waitForFunction(() => !document.querySelector('[role="menu"]'));
      await openMenu();
      assert.match(await compact.innerText(), /Connect to Pi/);
      await compact.press("Escape");
      await frame({ epoch: target.epoch });
      await chooseCompact();
      const confirm = page.getByRole("button", { name: "Compact now", exact: true });
      await confirm.waitFor();
      assert.match(
        await page.getByRole("region", { name: "Conversation compaction" }).innerText(),
        /does not clear the conversation/,
      );
      const box = await confirm.boundingBox();
      await page.screenshot({ path: `${output}/${engine}-${name}-confirm.png` });
      assert(
        box.height >= 44 && box.y >= 0 && box.y + box.height <= height,
        "confirmation must be visible and touch-sized",
      );
      assert.equal(await confirm.evaluate((node) => node === document.activeElement), true);
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
      );
      await page.screenshot({ path: `${output}/${engine}-${name}-confirm.png` });
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
      assert.equal(await page.getByRole("region", { name: "Conversation compaction" }).count(), 0);
      assert.equal(await trigger.evaluate((node) => node === document.activeElement), true);
      await chooseCompact();
      await confirm.press("Escape");
      assert.equal(await page.getByRole("region", { name: "Conversation compaction" }).count(), 0);
      assert.equal(await trigger.evaluate((node) => node === document.activeElement), true);
      assert.equal(compactions, 0);
      await trigger.focus();
      await trigger.press("Enter");
      await compact.press("Enter");
      await confirm.click();
      await page
        .getByText("Summarizing older context; waiting for Pi to finish…", { exact: true })
        .waitFor();
      assert.equal(await page.getByRole("button", { name: "Send message" }).isDisabled(), true);
      assert.equal(compactions, 1);
      release();
      await page
        .getByText("Conversation compacted. Older context summarized; your draft is unchanged.", {
          exact: true,
        })
        .waitFor();
      assert.equal(await draft.inputValue(), "Keep this draft");
      assert.equal(await page.getByRole("img", { name: "fixture.png" }).count(), 1);
      assert.equal(unexpected, 0);
      assert.deepEqual(errors, []);
      await page.screenshot({ path: `${output}/${engine}-${name}-complete.png` });
      await page.close();
      console.log(`${engine} ${name}: confirmed completion, touch layout and draft/images passed`);
    }
  } finally {
    await browser.close();
  }
}
