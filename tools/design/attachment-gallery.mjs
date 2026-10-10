// Synthetic draft/transcript gallery verification; every API/SSE request is intercepted.
// PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node tools/design/attachment-gallery.mjs URL
import assert from "node:assert/strict";
import fs from "node:fs/promises";
const { chromium, webkit } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.argv[2] || "http://127.0.0.1:5199";
const output = "design-gallery/attachment-gallery";
await fs.mkdir(output, { recursive: true });
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
  "base64",
);
const urls = Array.from(
  { length: 4 },
  (_, i) => `/api/uploads/a0000000-0000-4000-8000-00000000000${i + 1}.png`,
);
const agent = {
  agent: "pi",
  name: "gallery-fixture",
  pane_id: "w1:p1",
  tab_id: "w1:t1",
  tab_label: "Gallery",
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
    runtime: "a0000000-0000-4000-8000-000000000011",
    pid: 1,
    processStart: "1",
    pane: agent.pane_id,
    herdrSocket: "/fixture.sock",
    sessionId: "gallery-fixture",
    sessionFile: "/fixture.jsonl",
  },
  epoch: "a0000000-0000-4000-8000-000000000012",
  seq: 1,
  busy: false,
  sendPending: false,
  truncated: false,
  messages: [
    { id: "batch", role: "user", text: "Three reference images", attachments: urls.slice(0, 3) },
    { id: "single", role: "user", text: "A separate image", attachments: [urls[3]] },
  ],
  status: { cwd: "/fixture", totalTokens: 0, cost: 0 },
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
      ["ipad", 834, 1194],
      ["desktop", 1440, 1000],
    ]) {
      const page = await browser.newPage({ viewport: { width, height }, hasTouch: width < 1024 });
      const errors = [];
      let unexpected = 0;
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
          const path = new URL(route.request().url()).pathname;
          if (path === "/api/agents")
            return route.fulfill({
              json: {
                agents: [agent],
                workspaces: [{ workspace_id: "w1", label: "Fernblick" }],
                tabs: [],
              },
            });
          if (urls.includes(path))
            return route.fulfill(
              path === urls[1]
                ? { status: 404, body: "Unavailable" }
                : { contentType: "image/png", body: png },
            );
          unexpected++;
          return route.fulfill({ status: 503, json: { error: "Unexpected fixture request" } });
        },
      );
      await page.goto(base);
      await page.getByRole("tab", { name: "Agents", exact: true }).click();
      await page.getByTestId("pane-row").click();
      const draft = page.locator("#agent-prompt");
      await draft.fill("Keep this draft");
      await page.locator('input[type="file"]').setInputFiles(
        Array.from({ length: 10 }, (_, i) => ({
          name: `draft-${i + 1}.png`,
          mimeType: "image/png",
          buffer: png,
        })),
      );
      const trigger = page.getByRole("button", { name: "Preview image 10", exact: true });
      await trigger.focus();
      await page.keyboard.press("Enter");
      const modal = page.getByRole("dialog", { name: "Image preview" });
      await modal.waitFor();
      assert.equal(await modal.getByRole("img").getAttribute("alt"), "draft-10.png");
      assert.equal(await modal.getByRole("status").textContent(), "Image 10 of 10");
      const previewUrl = await modal.getByRole("img").getAttribute("src");
      await modal.getByRole("button", { name: "Next image", exact: true }).click();
      assert.equal(await modal.getByRole("status").textContent(), "Image 1 of 10");
      await page.keyboard.press("ArrowLeft");
      assert.equal(await modal.getByRole("img").getAttribute("src"), previewUrl);
      await page.keyboard.press("ArrowRight");
      assert.equal(await modal.getByRole("status").textContent(), "Image 1 of 10");
      const box = await modal.boundingBox();
      assert(
        box &&
          box.x >= 0 &&
          box.y >= 0 &&
          box.x + box.width <= width + 1 &&
          box.y + box.height <= height + 1,
      );
      for (const button of await modal.getByRole("button").all()) {
        const target = await button.boundingBox();
        assert(target && target.width >= 44 && target.height >= 44);
      }
      // The native modal traps focus and does not forward composer shortcuts.
      await page.keyboard.press("Tab");
      assert(await modal.evaluate((node) => node.contains(document.activeElement)));
      await page.screenshot({ path: `${output}/${engine}-${name}.png` });
      await page.keyboard.press("Escape");
      await modal.waitFor({ state: "detached" });
      assert(await trigger.evaluate((node) => document.activeElement === node));
      assert.equal(await draft.inputValue(), "Keep this draft");
      assert.equal(await page.getByRole("button", { name: /^Preview image / }).count(), 10);
      await page.getByRole("button", { name: "Remove image 10", exact: true }).click();
      assert.equal(await page.getByRole("button", { name: /^Preview image / }).count(), 9);

      // Per-message galleries cannot spill into the following message.
      await page
        .locator('[data-message-id="batch"]')
        .getByRole("button", { name: "Open attached image" })
        .first()
        .click();
      await modal.waitFor();
      assert.equal(await modal.getByRole("status").textContent(), "Image 1 of 3");
      await modal.getByRole("button", { name: "Next image", exact: true }).click();
      await modal.getByRole("img", { name: "Attachment unavailable" }).waitFor();
      await modal.getByRole("button", { name: "Next image", exact: true }).click();
      assert.equal(await modal.locator("img").getAttribute("src"), urls[2]);
      await modal.getByRole("button", { name: "Next image", exact: true }).click();
      assert.equal(await modal.locator("img").getAttribute("src"), urls[0]);
      await modal.getByRole("button", { name: "Close image preview" }).click();
      await modal.waitFor({ state: "detached" });
      await page
        .locator('[data-message-id="single"]')
        .getByRole("button", { name: "Open attached image" })
        .click();
      await modal.waitFor();
      assert.equal(await modal.getByRole("status").textContent(), "Image 1 of 1");
      assert.equal(await modal.getByRole("button", { name: "Next image", exact: true }).count(), 0);
      await page.keyboard.press("Escape");
      await modal.waitFor({ state: "detached" });
      assert.equal(unexpected, 0, "Preview must never upload or forward a prompt");
      assert.deepEqual(errors, []);
      await page.close();
      console.log(
        `${engine}: ${name} draft/chat galleries, wrap, keyboard, focus, failure fallback and draft retention passed`,
      );
    }
  } finally {
    await browser.close();
  }
}
