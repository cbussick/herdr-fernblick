// Production UI + real page projection, with synthetic session data only.
// All API/SSE requests are intercepted; no live agent, Herdr socket or model.
// PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node --import tsx tools/design/tree-pages.mjs URL
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { readTreePage } from "../../packages/pi-live-chat/treePage.ts";
import { contentText } from "../../packages/pi-live-chat/tree.ts";
const { chromium, webkit } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.argv[2] || "http://127.0.0.1:5208";
const output = "design-gallery/tree-pages";
await fs.mkdir(output, { recursive: true });
const agent = {
  agent: "pi",
  name: "tree-fixture",
  pane_id: "w1:p1",
  tab_id: "w1:t1",
  tab_label: "Long conversation",
  workspace_id: "w1",
  workspace_label: "Fixture",
  agent_status: "idle",
  revision: 1,
  focused: false,
  agent_session: { agent: "pi", kind: "path", source: "fixture", value: "/fixture.jsonl" },
};
const results = [];
for (const [engine, browserType] of [
  ["chromium", chromium],
  ["webkit", webkit],
]) {
  if (process.env.TREE_ENGINE && process.env.TREE_ENGINE !== engine) continue;
  const browser = await browserType.launch({ headless: true });
  try {
    for (const [device, width, height] of [
      ["small-phone", 320, 568],
      ["phone", 390, 844],
      ["keyboard", 390, 440],
      ["ipad", 834, 1194],
      ["desktop", 1440, 1000],
    ]) {
      if (process.env.TREE_DEVICE && process.env.TREE_DEVICE !== device) continue;
      const manager = SessionManager.inMemory();
      const ids = [];
      const fullPrompt = "A long original prompt. ".repeat(400) + "deep-search-needle";
      for (let i = 0; i < 354; i++) {
        ids.push(
          manager.appendMessage({
            role: "user",
            content: i === 2 ? fullPrompt : `Conversation turn ${i}`,
            timestamp: 1_700_000_000_000 + i,
          }),
        );
        for (let j = 0; j < 4; j++) manager.appendCustomEntry("extension-state", {});
      }
      const originalLeaf = manager.getLeafId();
      manager.branch(ids[0]);
      const alternate = manager.appendMessage({
        role: "user",
        content: "off-path-needle: an abandoned proposal",
        timestamp: 1_700_000_001_000,
      });
      manager.appendLabelChange(alternate, "Saved alternative");
      manager.branch(originalLeaf);
      let target = { runtime: randomUUID(), epoch: randomUUID(), sessionId: "fixture" };
      let snapshot = {
        type: "snapshot",
        version: 2,
        capabilities: { treePages: true },
        identity: {
          runtime: target.runtime,
          pid: 1,
          processStart: "1",
          pane: agent.pane_id,
          herdrSocket: "/fixture.sock",
          sessionId: target.sessionId,
          sessionFile: "/fixture.jsonl",
        },
        epoch: target.epoch,
        seq: 1,
        busy: false,
        sendPending: false,
        truncated: true,
        messages: [{ id: ids.at(-1), role: "user", text: "Conversation turn 353" }],
        status: { cwd: "/fixture", totalTokens: 0, cost: 0 },
      };
      const page = await browser.newPage({ viewport: { width, height }, hasTouch: width < 1024 });
      page.setDefaultTimeout(6000);
      const errors = [],
        unexpected = [],
        reads = [],
        navigations = [];
      let failNext = false;
      let failNavigation = false;
      page.on("pageerror", (error) => errors.push(error.message));
      await page.addInitScript((initial) => {
        window.EventSource = class {
          constructor() {
            window.fixtureStream = this;
            this.timer = setTimeout(() => this.onmessage?.({ data: JSON.stringify(initial) }), 20);
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
                workspaces: [{ workspace_id: "w1", label: "Fixture" }],
                tabs: [],
              },
            });
          if (path.endsWith("/tree-page")) {
            const body = route.request().postDataJSON();
            assert.deepEqual(body.target, target);
            reads.push(body.page);
            if (failNext) {
              failNext = false;
              return route.fulfill({ status: 409, json: { error: "Connection interrupted" } });
            }
            try {
              const result = readTreePage(manager, body.page);
              assert(result.rows.length <= 50);
              assert(Buffer.byteLength(JSON.stringify(result)) <= 128 * 1024);
              return route.fulfill({
                json: { type: "tree-page", id: randomUUID(), target, page: result },
              });
            } catch (error) {
              return route.fulfill({ status: 409, json: { error: error.message } });
            }
          }
          if (path.endsWith("/tree-navigation")) {
            const body = route.request().postDataJSON();
            assert.deepEqual(body.target, target);
            navigations.push(body.entryId);
            if (failNavigation) {
              failNavigation = false;
              return route.fulfill({
                status: 409,
                json: { error: "Navigation rejected; inspect Pi before trying again." },
              });
            }
            const entry = manager.getEntry(body.entryId);
            assert.equal(entry.message.role, "user");
            if (entry.parentId) manager.branch(entry.parentId);
            else manager.resetLeaf();
            manager.appendCustomEntry("plannotator", { phase: "idle" });
            target = { ...target, epoch: randomUUID() };
            snapshot = { ...snapshot, epoch: target.epoch, seq: 1, messages: [] };
            // Exercise the real console unmount-before-response ordering too.
            await page.evaluate(
              (value) => window.fixtureStream.onmessage({ data: JSON.stringify(value) }),
              snapshot,
            );
            return route.fulfill({
              json: {
                type: "navigated",
                id: randomUUID(),
                target,
                prompt: { text: contentText(entry.message.content), attachments: [] },
              },
            });
          }
          unexpected.push(path);
          return route.fulfill({ status: 503, json: { error: "Unexpected fixture request" } });
        },
      );
      try {
        await page.goto(base);
        await page.getByRole("tab", { name: "Agents", exact: true }).click();
        await page.getByTestId("pane-row").click();
        await page.locator("#agent-prompt").fill("Existing draft stays while browsing");
        const dialog = page.getByRole("dialog", { name: "Conversation paths" });
        const rows = dialog.getByTestId("conversation-tree__row");
        const ready = async () => {
          await page.waitForFunction(
            () =>
              document
                .querySelector('[aria-label="Conversation path browser"] [aria-busy]')
                ?.getAttribute("aria-busy") === "false",
          );
        };
        async function open() {
          await page
            .getByRole("button", { name: "More conversation actions", exact: true })
            .click();
          await page.getByRole("menuitem", { name: "Tree", exact: true }).click();
          await dialog.waitFor();
          await ready();
        }
        async function search(query) {
          await dialog.getByRole("searchbox").fill(query);
          await page.waitForTimeout(350);
          await ready();
        }
        const noOverflow = async () => {
          assert.equal(
            await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth),
            true,
            "dialog has no horizontal overflow",
          );
          const box = await dialog.boundingBox();
          assert(
            box.x >= 0 &&
              box.y >= 0 &&
              box.x + box.width <= width + 1 &&
              box.y + box.height <= height + 1,
          );
          for (const name of ["Cancel", "Edit and branch"]) {
            const box = await dialog.getByRole("button", { name, exact: true }).boundingBox();
            assert(box && box.y >= 0 && box.y + box.height <= height + 1, "footer stays reachable");
          }
        };
        await open();
        assert.equal(await rows.count(), 50);
        assert.equal(await rows.first().getAttribute("data-entry-id"), ids[304]);
        assert.equal(await dialog.locator('[aria-current="location"]').count(), 1);
        await noOverflow();
        await page.screenshot({ path: `${output}/${engine}-${device}-current.png` });
        await dialog.getByRole("button", { name: "Load earlier", exact: true }).click();
        await ready();
        assert.equal(await rows.count(), 50);
        assert.equal(await rows.first().getAttribute("data-entry-id"), ids[254]);
        await search("deep-search-needle");
        assert.equal(await rows.count(), 1);
        assert.equal(await rows.first().getAttribute("data-entry-id"), ids[2]);
        assert.equal(
          (await rows.first().innerText()).includes("deep-search-needle"),
          false,
          "search matched beyond the short preview",
        );
        await search("off-path-needle");
        assert.equal(await rows.first().getAttribute("data-entry-id"), alternate);
        assert((await rows.first().innerText()).includes("Other path"));
        await rows.first().getByRole("button", { name: "View path", exact: true }).click();
        await ready();
        assert.equal(await rows.count(), 2);
        await dialog.getByRole("button", { name: "2 branches", exact: true }).click();
        await ready();
        assert.equal(await rows.count(), 2);
        assert.equal(manager.getLeafId(), originalLeaf);
        await page.screenshot({ path: `${output}/${engine}-${device}-branches.png` });
        await rows.last().getByRole("button", { name: "View path", exact: true }).click();
        await ready();
        await dialog.getByRole("button", { name: "Labels", exact: true }).click();
        await page.waitForTimeout(350);
        await ready();
        assert.equal(await rows.count(), 1);
        assert.equal(await rows.first().getAttribute("data-entry-id"), alternate);
        await dialog.getByRole("button", { name: "Current path", exact: true }).click();
        await ready();
        manager.appendCustomEntry("new-state", {});
        await dialog.getByRole("button", { name: "Load earlier", exact: true }).click();
        await ready();
        const staleError = await dialog.getByRole("alert").innerText();
        assert(
          staleError.includes("Refresh paths"),
          `Expected stale-page feedback, got: ${staleError}`,
        );
        await dialog.getByRole("button", { name: "Refresh paths", exact: true }).click();
        await ready();
        assert.equal(await rows.count(), 50);
        failNext = true;
        await dialog.getByRole("button", { name: "Load earlier", exact: true }).click();
        await ready();
        assert((await dialog.getByRole("alert").innerText()).includes("Connection interrupted"));
        const afterFailure = reads.length;
        await page.waitForTimeout(150);
        assert.equal(reads.length, afterFailure, "no retry after read failure");
        await dialog.getByRole("button", { name: "Refresh paths", exact: true }).click();
        await ready();
        await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
        await dialog.waitFor({ state: "hidden" });
        assert.equal(
          await page.locator("#agent-prompt").inputValue(),
          "Existing draft stays while browsing",
        );
        assert.equal(navigations.length, 0);
        await page.locator("#agent-prompt").fill("");
        await open();
        await search("deep-search-needle");
        await rows.first().locator("button[aria-pressed]").click();
        const beforeNavigationLeaf = manager.getLeafId();
        failNavigation = true;
        await dialog.getByRole("button", { name: "Edit and branch", exact: true }).click();
        await dialog.getByRole("alert").waitFor();
        assert((await dialog.getByRole("alert").innerText()).includes("Navigation rejected"));
        await noOverflow();
        await page.screenshot({ path: `${output}/${engine}-${device}-navigation-error.png` });
        await page.waitForTimeout(150);
        assert.equal(navigations.length, 1, "navigation failure is not retried");
        assert.equal(manager.getLeafId(), beforeNavigationLeaf);
        assert.equal(await page.locator("#agent-prompt").inputValue(), "");
        await dialog.getByRole("button", { name: "Edit and branch", exact: true }).click();
        await dialog.waitFor({ state: "hidden" });
        await page.waitForFunction(
          (text) => document.querySelector("#agent-prompt").value === text,
          fullPrompt,
        );
        assert.deepEqual(navigations, [ids[2], ids[2]]);
        assert(manager.getEntry(ids[353]), "original branch preserved");
        await open();
        await dialog.getByRole("button", { name: "View continuation", exact: true }).click();
        await ready();
        assert.equal(await rows.first().getAttribute("data-entry-id"), ids[2]);
        assert.deepEqual(errors, []);
        assert.deepEqual(unexpected, []);
        results.push({ engine, device, passed: true, reads: reads.length });
        console.log(
          `PASS ${engine}/${device}: paging, global search, forks, stale/error recovery, cancel, full prompt restore`,
        );
      } catch (error) {
        results.push({ engine, device, passed: false, error: error.message });
        console.log(`FAIL ${engine}/${device}: ${error.message}`);
        await page.screenshot({ path: `${output}/${engine}-${device}-failure.png` });
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }
}
await fs.writeFile(`${output}/results.json`, JSON.stringify(results, null, 2));
if (results.some((result) => !result.passed)) process.exitCode = 1;
