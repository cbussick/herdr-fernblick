// All API/SSE traffic is intercepted. Never controls existing agents.
// PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node tools/design/model-picker.mjs URL
import assert from "node:assert/strict";
import fs from "node:fs/promises";
const { chromium, webkit } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.argv[2] || "http://127.0.0.1:5197";
const output = "design-gallery/model-picker";
await fs.mkdir(output, { recursive: true });
const target = {
  runtime: "a0000000-0000-4000-8000-000000000001",
  epoch: "a0000000-0000-4000-8000-000000000002",
  sessionId: "model-fixture",
};
const agent = {
  agent: "pi",
  name: "model-fixture",
  pane_id: "w1:p1",
  tab_id: "w1:t1",
  tab_label: "Model picker",
  workspace_id: "w1",
  workspace_label: "Fernblick",
  agent_status: "idle",
  revision: 1,
  focused: false,
  agent_session: { agent: "pi", kind: "path", source: "fixture", value: "/fixture.jsonl" },
};
const models = [
  { id: "claude-sonnet-4-6", provider: "anthropic", name: "Claude Sonnet 4.6" },
  { id: "gpt-5.4", provider: "openai-codex", name: "GPT-5.4" },
];
const snapshot = {
  type: "snapshot",
  version: 2,
  capabilities: {
    models: true,
    thinking: true,
    compact: true,
    skills: true,
    boards: true,
    defaults: true,
  },
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
    { id: "m1", role: "assistant", text: "Switch models without losing the conversation." },
  ],
  status: {
    cwd: "/projects/fernblick",
    model: models[0].id,
    provider: models[0].provider,
    totalTokens: 0,
    cost: 0,
    thinkingLevel: "medium",
  },
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
      ["desktop", 1440, 1000],
    ]) {
      const page = await browser.newPage({ viewport: { width, height }, hasTouch: width < 1024 });
      const errors = [];
      let reads = 0,
        changes = 0,
        unexpected = 0,
        release;
      let fail = false;
      const savedDefaults = [];
      let defaults = {
        model: { provider: models[0].provider, modelId: models[0].id },
        thinkingLevel: "medium",
      };
      let thinkingReads = 0,
        thinkingChanges = 0,
        thinkingMode = "normal";
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
          if (path.endsWith("/save-default")) {
            const body = route.request().postDataJSON();
            assert.deepEqual(body.target, target);
            if (body.selection.kind === "model") {
              assert.equal(body.selection.provider, models[1].provider);
              assert.equal(body.selection.modelId, models[1].id);
              defaults = {
                ...defaults,
                model: { provider: body.selection.provider, modelId: body.selection.modelId },
              };
            } else {
              assert.equal(body.selection.provider, models[0].provider);
              assert.equal(body.selection.modelId, models[0].id);
              assert.equal(body.selection.level, "high");
              defaults = { ...defaults, thinkingLevel: body.selection.level };
            }
            savedDefaults.push(body.selection);
            return route.fulfill({
              json: {
                type: "default-saved",
                id: target.runtime,
                target,
                selection: body.selection,
              },
            });
          }
          if (path.endsWith("/thinking-levels")) {
            thinkingReads++;
            return route.fulfill({
              json: {
                type: "thinking-levels",
                id: target.runtime,
                target,
                provider: models[0].provider,
                modelId: models[0].id,
                level: thinkingMode === "off" ? "off" : "medium",
                levels: thinkingMode === "off" ? ["off"] : ["low", "medium", "high"],
                defaults,
              },
            });
          }
          if (path.endsWith("/set-thinking-level")) {
            thinkingChanges++;
            assert.deepEqual(route.request().postDataJSON(), {
              target,
              provider: models[0].provider,
              modelId: models[0].id,
              level: "high",
            });
            return route.fulfill({
              json: {
                type: "thinking-level-changed",
                id: target.runtime,
                target,
                provider: models[0].provider,
                modelId: models[0].id,
                level: "high",
              },
            });
          }
          if (path.endsWith("/models")) {
            reads++;
            return route.fulfill({
              json: {
                type: "models",
                id: target.runtime,
                target,
                models,
                truncated: false,
                defaults,
              },
            });
          }
          if (path.endsWith("/set-model")) {
            changes++;
            assert.deepEqual(route.request().postDataJSON(), {
              target,
              provider: models[1].provider,
              modelId: models[1].id,
            });
            if (fail)
              return route.fulfill({
                status: 409,
                json: { error: "Model unavailable. Check Pi before retrying." },
              });
            await new Promise((resolve) => {
              release = resolve;
            });
            return route.fulfill({
              json: { type: "model-changed", id: target.runtime, target, model: models[1] },
            });
          }
          unexpected++;
          return route.fulfill({ status: 503, json: { error: "Unexpected fixture request" } });
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
      const more = page.getByRole("button", { name: "More conversation actions", exact: true });
      const trigger = more;
      async function openPicker(label = "Model") {
        await more.click();
        await page.getByRole("menuitem", { name: label, exact: true }).click();
      }
      assert.equal(reads, 0);
      const toolbar = more.locator("..");
      const origin = await more.boundingBox();
      for (const button of await toolbar.getByRole("button").all()) {
        const box = await button.boundingBox();
        assert(box.width >= 44 && box.height >= 44);
        assert.equal(box.y, origin.y);
        assert(box.x >= 0 && box.x + box.width <= width);
      }
      assert.equal(
        await page.getByRole("button", { name: "Change model", exact: true }).count(),
        0,
      );
      assert.equal(await toolbar.getByRole("button").count(), 5);
      await page.screenshot({ path: `${output}/${engine}-${name}-toolbar.png` });
      await more.click();
      const tree = page.getByRole("menuitem", { name: "Tree", exact: true });
      assert.equal(await tree.locator("svg").count(), 1);
      assert.equal((await tree.innerText()).trim(), "Tree");
      for (const label of ["Model", "Thinking level"]) {
        const row = page.getByRole("menuitem", { name: label, exact: true });
        assert.equal(await row.locator("svg").count(), 1);
        assert.equal((await row.innerText()).trim(), label);
      }
      assert.equal(reads, 0);
      assert.equal(thinkingReads, 0);
      await page.screenshot({ path: `${output}/${engine}-${name}-menu.png` });
      await tree.press("Escape");
      assert.equal(await more.evaluate((node) => node === document.activeElement), true);
      await openPicker();
      const dialog = page.getByRole("dialog", { name: "Choose model", exact: true });
      const search = page.getByRole("searchbox", { name: "Search models" });
      const other = dialog.getByRole("button", { name: /^GPT-5.4/ });
      await other.waitFor();
      assert.equal(reads, 1);
      assert.equal(await dialog.locator('[aria-pressed="true"]').count(), 1);
      assert.equal(await search.evaluate((node) => node === document.activeElement), true);
      await search.fill("not-a-model");
      await page.getByText("No matching models.", { exact: true }).waitFor();
      await search.press("Enter");
      assert.equal(changes, 0);
      await search.fill("openai");
      assert.equal(await dialog.locator("[aria-pressed]").count(), 1);
      await search.press("ArrowDown");
      assert.equal(await other.evaluate((node) => node === document.activeElement), true);
      const box = await dialog.boundingBox();
      assert(
        box.x >= 0 && box.y >= 0 && box.x + box.width <= width && box.y + box.height <= height,
      );
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
      );
      const saveModel = dialog.getByTestId("global-default");
      await other.press("Tab");
      assert.equal(await saveModel.evaluate((node) => node === document.activeElement), true);
      assert.equal(
        await saveModel.getAttribute("aria-label"),
        "Set GPT-5.4 (openai-codex) as global default",
      );
      await saveModel.press("Enter");
      await dialog
        .getByRole("status")
        .filter({ hasText: "GPT-5.4 saved as global default." })
        .waitFor();
      assert.equal(await saveModel.getAttribute("data-default"), "true");
      assert.equal(await saveModel.evaluate((node) => node === document.activeElement), true);
      assert.equal(await saveModel.innerText(), "Default");
      assert.equal(await dialog.locator("footer").count(), 0);
      assert.equal(await dialog.getByText("For new Pi sessions", { exact: false }).count(), 0);
      assert.equal(savedDefaults.length, 1);
      assert.equal(savedDefaults[0].kind, "model");
      assert.equal(changes, 0);
      assert.equal(await draft.inputValue(), "Keep this draft");
      const saveBox = await saveModel.boundingBox();
      assert(
        saveBox.width >= 44 &&
          saveBox.height >= 44 &&
          saveBox.x >= 0 &&
          saveBox.x + saveBox.width <= width,
      );
      await page.screenshot({ path: `${output}/${engine}-${name}-picker.png` });
      await other.press("Enter");
      await page.getByText("Changing model…", { exact: true }).waitFor();
      assert.equal(changes, 1);
      release();
      await dialog.waitFor({ state: "detached" });
      assert.equal(await trigger.evaluate((node) => node === document.activeElement), true);
      assert.equal(await draft.inputValue(), "Keep this draft");
      assert.equal(await page.getByRole("img", { name: "fixture.png" }).count(), 1);
      fail = true;
      await openPicker();
      assert.equal(
        await dialog
          .getByRole("button", { name: "Global default: GPT-5.4 (openai-codex)", exact: true })
          .getAttribute("data-default"),
        "true",
      );
      await other.click();
      await page.getByRole("alert").filter({ hasText: "Model unavailable" }).waitFor();
      assert.equal(changes, 2);
      await dialog.press("Escape");
      await openPicker("Thinking level");
      const thinkingDialog = page.getByRole("dialog", {
        name: "Choose thinking level",
        exact: true,
      });
      const high = thinkingDialog.getByRole("button", { name: "High", exact: true });
      await high.waitFor();
      assert.equal(thinkingReads, 1);
      const current = thinkingDialog.getByRole("button", { name: "Medium · Current", exact: true });
      assert.equal(await current.evaluate((node) => node === document.activeElement), true);
      await current.press("ArrowDown");
      assert.equal(await high.evaluate((node) => node === document.activeElement), true);
      const thinkingBox = await thinkingDialog.boundingBox();
      assert(
        thinkingBox.x >= 0 &&
          thinkingBox.y >= 0 &&
          thinkingBox.x + thinkingBox.width <= width &&
          thinkingBox.y + thinkingBox.height <= height,
      );
      await thinkingDialog
        .getByRole("button", { name: "Set High as global default", exact: true })
        .click();
      await thinkingDialog
        .getByRole("status")
        .filter({ hasText: "High saved as global default." })
        .waitFor();
      assert.equal(
        await thinkingDialog
          .getByRole("button", { name: "Global default: High", exact: true })
          .innerText(),
        "Default",
      );
      assert.equal(await current.getAttribute("aria-pressed"), "true");
      assert.equal(savedDefaults.length, 2);
      assert.equal(savedDefaults[1].kind, "thinking");
      assert.equal(thinkingChanges, 0);
      await page.screenshot({ path: `${output}/${engine}-${name}-thinking.png` });
      await high.press("Enter");
      await thinkingDialog.waitFor({ state: "detached" });
      assert.equal(thinkingChanges, 1);
      await openPicker("Thinking level");
      assert.equal(
        await thinkingDialog
          .getByRole("button", { name: "Global default: High", exact: true })
          .getAttribute("data-default"),
        "true",
      );
      await thinkingDialog.press("Escape");
      assert.equal(await trigger.evaluate((node) => node === document.activeElement), true);
      thinkingMode = "off";
      await openPicker("Thinking level");
      await page.getByText("This model does not support thinking.", { exact: true }).waitFor();
      assert.equal(
        await thinkingDialog.getByRole("button", { name: "High", exact: true }).count(),
        0,
      );
      await thinkingDialog.press("Escape");
      await openPicker();
      await page.evaluate(
        (initial) =>
          window.fixtureStream.onmessage({
            data: JSON.stringify({
              ...initial,
              seq: 2,
              epoch: "a0000000-0000-4000-8000-000000000003",
            }),
          }),
        snapshot,
      );
      await dialog.waitFor({ state: "detached" });
      assert.equal(changes, 2);
      assert.equal(await draft.inputValue(), "Keep this draft");
      assert.equal(unexpected, 0);
      assert.deepEqual(errors, []);
      await page.close();
      console.log(
        `${engine} ${name}: toolbar, icon menu, picker, keyboard, mutation, failure and stale-target checks passed`,
      );
    }
  } finally {
    await browser.close();
  }
}
