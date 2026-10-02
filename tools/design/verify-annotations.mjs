// Synthetic browser checks only. Every API request and SSE stream is replaced;
// this script never sends a prompt to a real agent.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
const { chromium, webkit } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.argv[2] || "http://100.71.229.1:5186";
const out = "design-gallery/annotations";
await fs.mkdir(out, { recursive: true });
const target = {
  runtime: "a0000000-0000-4000-8000-000000000001",
  epoch: "a0000000-0000-4000-8000-000000000002",
  sessionId: "annotation-fixture",
};
const messages = [
  { id: "u1", role: "user", text: "Make the workspace overview easier to scan on my phone." },
  { id: "t1", role: "thinking", text: "Checking the overview layout and touch targets." },
  { id: "tool1", role: "tool", toolName: "read", text: "WorkspaceList implementation" },
  {
    id: "a1",
    role: "assistant",
    text: "I’ve simplified the workspace list and kept each agent’s status beside its name.\n\nThe phone view remains focused on one task. On larger screens, the workspace list stays open alongside your conversation.\n\nThe changes are ready to review.",
  },
  {
    id: "a2",
    role: "assistant",
    text: "See https://example.com/layout for the reference. Keep the workspace list. Keep the workspace list.",
  },
];
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
  messages,
  status: {
    cwd: "/projects/fernblick",
    model: "GPT-6.1",
    provider: "OpenAI",
    totalTokens: 12480,
    cost: 0.18,
  },
};
const agent = {
  agent: "pi",
  name: "annotation-fixture",
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
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 834, height: 1194 },
    { width: 1440, height: 1000 },
  ]) {
    const page = await browser.newPage({
      viewport,
      reducedMotion: "reduce",
      hasTouch: viewport.width < 1000,
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const sends = [];
    let failure = false;
    let hold = false;
    let release;
    await page.addInitScript((initial) => {
      window.annotationSnapshot = initial;
      window.annotationStreams = new Set();
      window.EventSource = class {
        constructor() {
          window.annotationStreams.add(this);
          this.timer = setTimeout(
            () => this.onmessage?.({ data: JSON.stringify(window.annotationSnapshot) }),
            30,
          );
        }
        close() {
          clearTimeout(this.timer);
          window.annotationStreams.delete(this);
        }
      };
      window.updateAnnotationSnapshot = (update) => {
        window.annotationSnapshot = {
          ...window.annotationSnapshot,
          ...update,
          seq: window.annotationSnapshot.seq + 1,
        };
        for (const stream of window.annotationStreams)
          stream.onmessage?.({ data: JSON.stringify(window.annotationSnapshot) });
      };
    }, snapshot);
    await page.route(
      (url) => url.pathname.startsWith("/api/"),
      async (route) => {
        const url = route.request().url();
        if (url.endsWith("/api/agents"))
          return route.fulfill({
            json: {
              agents: [agent],
              tabs: [],
              workspaces: [{ workspace_id: "w1", label: "Fernblick" }],
            },
          });
        if (url.endsWith("/prompt")) {
          sends.push(route.request().postDataJSON());
          if (hold)
            await new Promise((resolve) => {
              release = resolve;
            });
          return route.fulfill(
            failure
              ? { status: 503, json: { error: "Forwarding uncertain" } }
              : {
                  json: {
                    type: "ack",
                    id: route.request().postDataJSON().requestId,
                    outcome: "invoked",
                  },
                },
          );
        }
        if (url.includes("/output?"))
          return route.fulfill({
            json: {
              format: "text",
              pane_id: "w1:p1",
              tab_id: "w1:t1",
              workspace_id: "w1",
              revision: 1,
              source: "fixture",
              truncated: false,
              text: "Synthetic terminal",
            },
          });
        return route.fulfill({ status: 503, json: { error: "Unexpected fixture request" } });
      },
    );
    const select = async (selector, start, end, touch = false) => {
      await page.locator(selector).scrollIntoViewIfNeeded();
      await page.evaluate(
        ({ selector, start, end, touch }) => {
          const element = document.querySelector(selector);
          document.activeElement?.blur();
          element.dispatchEvent(
            new PointerEvent("pointerdown", {
              bubbles: true,
              pointerType: touch ? "touch" : "mouse",
            }),
          );
          const nodes = [];
          const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
          while (walker.nextNode()) nodes.push(walker.currentNode);
          function point(offset) {
            for (const node of nodes) {
              if (offset <= node.textContent.length) return [node, offset];
              offset -= node.textContent.length;
            }
            throw new Error("Selection offset out of bounds");
          }
          const range = document.createRange();
          range.setStart(...point(start));
          range.setEnd(...point(end));
          const selection = window.getSelection();
          selection.removeAllRanges();
          selection.addRange(range);
          element.dispatchEvent(
            new PointerEvent("pointerup", {
              bubbles: true,
              pointerType: touch ? "touch" : "mouse",
            }),
          );
        },
        { selector, start, end, touch },
      );
    };
    const source = '[data-annotation-source="a1"]';
    const comment = page.getByRole("textbox", { name: "Your comment" });
    const tray = page.getByRole("region", { name: "Pending annotations" });
    const update = (patch) =>
      page.evaluate((value) => window.updateAnnotationSnapshot(value), patch);
    async function save(text) {
      await comment.fill(text);
      await comment.press("Enter");
      await comment.waitFor({ state: "hidden" });
    }
    async function assertLayout() {
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
      );
      const popup = page.getByRole("dialog", { name: "Comment on passage" });
      if (await popup.count()) {
        const box = await popup.boundingBox();
        assert.ok(
          box.x >= 0 &&
            box.y >= 0 &&
            box.x + box.width <= viewport.width + 1 &&
            box.y + box.height <= viewport.height + 1,
        );
      }
    }
    try {
      await page.goto(base);
      await page.getByRole("tab", { name: "Agents", exact: true }).click();
      await page.getByTestId("pane-row").first().click();
      await page.locator(source).waitFor();
      await select(source, 0, 30);
      assert.equal(await comment.count(), 0, "selection does nothing outside annotation mode");
      await page.getByRole("button", { name: "Annotate", exact: true }).click();
      await select('[data-testid="chat-transcript"] article:first-of-type p', 0, 20);
      assert.equal(await comment.count(), 0, "user messages cannot be annotated");
      await page.getByTestId("chat-tool").locator("summary").click();
      await select('[data-testid="chat-tool"] pre', 0, 10);
      assert.equal(await comment.count(), 0, "tool output cannot be annotated");
      await page.getByTestId("chat-tool").locator("summary").click();
      await page.evaluate(() => {
        const range = document.createRange();
        range.setStart(document.querySelector('[data-annotation-source="a1"]').firstChild, 0);
        range.setEnd(document.querySelector('[data-annotation-source="a2"]').firstChild, 2);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        document.dispatchEvent(
          new PointerEvent("pointerup", { bubbles: true, pointerType: "mouse" }),
        );
      });
      assert.equal(await comment.count(), 0, "cross-message selections are rejected");
      await page.locator("#agent-prompt").fill("Keep my ordinary draft");
      const passageStart = messages[3].text.indexOf("The phone view");
      await select(
        source,
        passageStart,
        passageStart + "The phone view remains focused on one task.".length,
        viewport.width < 1000,
      );
      await comment.waitFor();
      if (viewport.width < 1000)
        assert.notEqual(
          await page.evaluate(() => document.activeElement?.id),
          "annotation-comment",
          "touch selection must not steal focus",
        );
      await comment.fill("Keep the status visible on smaller screens, too.");
      await assertLayout();
      await page.screenshot({ path: `${out}/${engine.name()}-${viewport.width}-popover.png` });
      await comment.press("Enter");
      await comment.waitFor({ state: "hidden" });
      assert.ok(await page.locator(`${source} mark`).count());
      await page.getByRole("button", { name: "Annotate", exact: true }).click();
      assert.equal(await tray.count(), 1, "mode-off preserves pending comments");
      await page.getByRole("button", { name: "Switch to Terminal view" }).click();
      await page.getByRole("button", { name: "Switch to Chat view" }).click();
      assert.equal(await tray.count(), 1, "terminal switch preserves comments");
      await page.getByRole("button", { name: "Annotate", exact: true }).click();
      await select('[data-annotation-source="a2"]', 4, 44);
      await save("Use the new layout reference.");
      await tray.getByRole("button", { name: /2 pending comments/ }).click();
      await tray.getByRole("button", { name: "Edit comment 1" }).click();
      await save("Keep the status visible on every screen.");
      await page.screenshot({ path: `${out}/${engine.name()}-${viewport.width}-tray.png` });
      await assertLayout();
      assert.equal(sends.length, 0, "saving comments never sends a prompt");
      await update({ busy: true });
      assert.equal(
        await tray.getByRole("button", { name: "Send comments", exact: true }).isDisabled(),
        true,
      );
      await update({ busy: false, sendPending: true });
      assert.equal(
        await tray.getByRole("button", { name: "Send comments", exact: true }).isDisabled(),
        true,
      );
      await update({ sendPending: false, version: 1 });
      assert.equal(
        await tray.getByRole("button", { name: "Send comments", exact: true }).isDisabled(),
        true,
      );
      await update({ version: 2 });
      await page.evaluate(() => {
        for (const stream of window.annotationStreams) stream.onerror?.();
      });
      await tray.getByText("Reconnect to Pi before sending comments.").waitFor();
      assert.equal(
        await tray.getByRole("button", { name: "Send comments", exact: true }).isDisabled(),
        true,
      );
      await update({});
      await page.locator('input[type="file"]').setInputFiles({
        name: "fixture.png",
        mimeType: "image/png",
        buffer: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
          "base64",
        ),
      });
      failure = true;
      await tray.getByRole("button", { name: "Send comments", exact: true }).click();
      await tray.getByRole("alert").waitFor();
      assert.equal(sends.length, 1);
      assert.match(sends[0].text, /Keep the status visible on every screen/);
      assert.match(sends[0].text, /response a2/);
      assert.deepEqual(sends[0].attachments, []);
      assert.equal(await page.locator("#agent-prompt").inputValue(), "Keep my ordinary draft");
      await page.waitForTimeout(150);
      assert.equal(sends.length, 1, "no automatic retry");
      failure = false;
      hold = true;
      await tray.getByRole("button", { name: "Send comments", exact: true }).click();
      await page.waitForFunction(
        () =>
          document.querySelector('[aria-label="Pending annotations"]').getAttribute("aria-busy") ===
          "true",
      );
      assert.equal(
        await page.getByRole("button", { name: "Send message", exact: true }).isDisabled(),
        true,
      );
      assert.equal(await tray.getByRole("button", { name: "Edit comment 1" }).isDisabled(), true);
      while (!release) await page.waitForTimeout(10);
      release();
      hold = false;
      await tray.waitFor({ state: "hidden" });
      assert.equal(sends.length, 2);
      assert.equal(await page.locator("#agent-prompt").inputValue(), "Keep my ordinary draft");
      assert.equal(await page.locator(`${source} mark`).count(), 0);
      assert.equal(
        await page.getByLabel("Image attachments").count(),
        1,
        "annotation sends preserve ordinary image drafts",
      );
      await page.getByRole("button", { name: "Remove image 1" }).click();
      // Whole-response control is the keyboard/touch fallback; Escape cancels.
      await page.getByRole("button", { name: "Comment on response", exact: true }).first().click();
      await comment.press("Escape");
      assert.equal(await tray.count(), 0);
      await page.getByRole("button", { name: "Comment on response", exact: true }).first().click();
      await comment.fill("first line");
      await comment.dispatchEvent("keydown", { key: "Enter", isComposing: true });
      assert.equal(await comment.count(), 1, "IME confirmation is not comment submission");
      await comment.press("Shift+Enter");
      await comment.press("a");
      assert.match(await comment.inputValue(), /\n/);
      await comment.press("Enter");
      const review = tray.getByRole("button", { name: /1 pending comment/ });
      if ((await review.getAttribute("aria-expanded")) !== "true") await review.click();
      await tray.getByRole("button", { name: "Remove comment 1" }).click();
      await tray.waitFor({ state: "hidden" });
      await select(source, 0, 30);
      await save("Do not send this into a replacement session.");
      await update({ epoch: "a0000000-0000-4000-8000-000000000003" });
      await tray.getByRole("button", { name: "Discard old comments" }).waitFor();
      assert.equal(
        await tray.getByRole("button", { name: "Send comment", exact: true }).isDisabled(),
        true,
      );
      assert.equal(sends.length, 2);
      await tray.getByRole("button", { name: "Discard old comments" }).click();
      await tray.waitFor({ state: "hidden" });
      assert.deepEqual(errors, []);
      console.log(`${engine.name()} ${viewport.width}: annotation flow passed`);
    } catch (error) {
      await page.screenshot({ path: `${out}/failure-${engine.name()}-${viewport.width}.png` });
      throw error;
    } finally {
      await page.close();
    }
  }
  await browser.close();
}
