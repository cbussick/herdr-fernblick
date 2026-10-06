// Synthetic browser checks only. Every API request and SSE stream is replaced;
// this script never sends a prompt to a real agent.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
const { chromium, webkit } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.argv[2] || "http://100.71.229.1:5186";
// Optional third argument runs one case, e.g. webkit:834.
const only = process.argv[3];
assert.ok(
  !only || /^(chromium|webkit):(390|834|1194|1440)$/.test(only),
  "Unknown browser/viewport case",
);
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
  {
    id: "a3",
    role: "assistant",
    text: "Before **[Open the app → http://100.71.229.1:41227](http://100.71.229.1:41227)** then `main` and [[https://example.com|Docs]].",
  },
  {
    id: "a4",
    role: "assistant",
    text:
      "## Implementation notes\n\n3. **Preserve annotations**\n   - Nested detail\n4. Check copying\n\n> First quoted line\n> Second quoted line\n\n- [x] Implemented\n- [ ] Reviewed\n\n```js\nconst value = '<tag>';\n  // " +
      "long code line ".repeat(35) +
      "\n```\n\nAfter the code toolbar.\n\n| Feature | Result | Details |\n| :--- | ---: | :---: |\n| **Lists** | Ready | nested |\n| Code | Copied | final cell |",
  },
  {
    id: "u2",
    role: "user",
    text: "### User formatting\n\n- **First**\n- Second\n\n> Quoted text\n\n- [x] Done\n\n| Name | Value |\n| --- | --- |\n| a | b |\n\n~~~txt\nuser code\n~~~",
  },
  {
    id: "a5",
    role: "assistant",
    text: "# Heading one\n\n## Heading two\n\n### Heading three\n\n#### Heading four\n\n##### Heading five\n\n###### Heading six\n\nPlain text and *Italic sample*.\n\n**Bold with *nested italic*.**\n\n| Format | Example |\n| --- | --- |\n| Emphasis | *Table italic* |",
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
  if (only && !only.startsWith(`${engine.name()}:`)) continue;
  const browser = await engine.launch({ headless: true });
  for (const { touch, ...viewport } of [
    { width: 390, height: 844, touch: true },
    { width: 834, height: 1194, touch: true },
    { width: 1194, height: 834, touch: true },
    { width: 1440, height: 1000, touch: false },
  ]) {
    if (only && only !== `${engine.name()}:${viewport.width}`) continue;
    const page = await browser.newPage({ viewport, reducedMotion: "reduce", hasTouch: touch });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const sends = [];
    let failure = false;
    let hold = false;
    let release;
    await page.addInitScript((initial) => {
      window.annotationSnapshot = initial;
      window.markdownCopies = [];
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText: async (text) => window.markdownCopies.push(text) },
      });
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
          if (touch !== null)
            element.dispatchEvent(
              new PointerEvent("pointerdown", {
                bubbles: true,
                pointerType: touch ? "touch" : "mouse",
              }),
            );
          const nodes = [];
          const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
          while (walker.nextNode()) {
            if (
              element.closest("[data-message-control]") ||
              !walker.currentNode.parentElement.closest("[data-message-control]")
            )
              nodes.push(walker.currentNode);
          }
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
          if (touch !== null)
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
    const action = page.getByRole("button", { name: "Comment", exact: true });
    async function openComment() {
      await action.waitFor();
      if (touch) await action.tap();
      else await action.click();
      await comment.waitFor();
    }
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
      assert.equal(await page.getByRole("button", { name: "Annotate", exact: true }).count(), 0);
      assert.equal(
        await page.getByRole("button", { name: "Comment on response", exact: true }).count(),
        0,
      );
      assert.equal(await action.count(), 0, "passage comments still require a selection");
      const generalAction = page.getByRole("button", { name: "Add general comment", exact: true });
      const activate = (locator) => (touch ? locator.tap() : locator.click());
      assert.equal(await generalAction.count(), 0, "general feedback cannot start a batch");
      assert.equal(await tray.count(), 0);
      const typography = page.locator('[data-annotation-source="a5"]');
      await page.evaluate(() => document.fonts.ready);
      for (const selector of ["p > em", "strong > em", "td em"]) {
        const italic = typography.locator(selector).first();
        assert.equal(
          await italic.evaluate((element) => getComputedStyle(element).fontStyle),
          "italic",
        );
        const paintedItalic = await italic.screenshot();
        await italic.evaluate((element) => {
          element.style.fontStyle = "normal";
        });
        const paintedNormal = await italic.screenshot();
        await italic.evaluate((element) => {
          element.style.removeProperty("font-style");
        });
        assert.equal(
          paintedItalic.equals(paintedNormal),
          false,
          "Markdown italics must visibly differ from upright text, not just have computed font-style: italic",
        );
      }
      const sizes = await typography
        .locator("h1, h2, h3, h4, h5, h6")
        .evaluateAll((elements) =>
          elements.map((element) => parseFloat(getComputedStyle(element).fontSize)),
        );
      assert.equal(sizes.length, 6);
      for (let level = 1; level < sizes.length; level++)
        assert.ok(
          sizes[level - 1] > sizes[level],
          "every heading level must have a distinct descending size",
        );
      assert.ok(
        sizes[5] >=
          (await typography.evaluate((element) => parseFloat(getComputedStyle(element).fontSize))),
        "deep headings must not be smaller than body text",
      );
      await typography.screenshot({
        path: `${out}/${engine.name()}-${viewport.width}-typography.png`,
      });
      for (const quote of ["Italic sample", "nested italic", "Table italic"]) {
        const start = messages[8].text.indexOf(quote);
        await select('[data-annotation-source="a5"]', start, start + quote.length, touch);
        await openComment();
        assert.equal(
          await page
            .getByRole("dialog", { name: "Comment on passage" })
            .locator("blockquote")
            .textContent(),
          quote,
        );
        await comment.press("Escape");
      }
      const blockSource = '[data-annotation-source="a4"]';
      const blockText = messages[6].text;
      const blocks = page.locator(blockSource);
      assert.equal(await blocks.locator("h2").innerText(), "Implementation notes");
      assert.equal(await blocks.locator("ol").getAttribute("start"), "3");
      assert.equal(await blocks.locator("ol ul li").count(), 1);
      assert.equal(
        await blocks.locator("blockquote").innerText(),
        "First quoted line\nSecond quoted line",
      );
      assert.equal(await blocks.getByRole("checkbox").count(), 2);
      assert.equal(await blocks.getByRole("checkbox").first().isChecked(), true);
      assert.equal(await blocks.getByRole("checkbox").last().isChecked(), false);
      assert.equal(await blocks.getByRole("checkbox").first().isDisabled(), true);
      assert.equal(await blocks.locator("th").count(), 3);
      assert.equal(await blocks.locator('td[data-align="right"]').first().innerText(), "Ready");
      assert.equal(
        await blocks.locator('td[data-align="center"]').last().innerText(),
        "final cell",
      );
      assert.equal(
        await blocks.evaluate((element) => {
          const copy = element.cloneNode(true);
          copy.querySelectorAll("[data-message-control]").forEach((control) => control.remove());
          return copy.textContent;
        }),
        blockText,
        "block rendering retains every original source character exactly once",
      );
      const codePayload = "const value = '<tag>';\n  // " + "long code line ".repeat(35);
      assert.equal(await blocks.locator("pre").innerText(), codePayload);
      const copyCode = blocks.getByRole("button", { name: "Copy code" });
      await activate(copyCode);
      assert.equal(await copyCode.innerText(), "Copied");
      assert.deepEqual(await page.evaluate(() => window.markdownCopies), [codePayload]);
      await select(`${blockSource} button`, 0, 4, touch);
      assert.equal(await action.count(), 0, "copy controls cannot become annotation passages");
      assert.ok(
        await blocks
          .locator("blockquote")
          .evaluate((element) => parseFloat(getComputedStyle(element).marginTop) > 0),
        "block spacing survives hidden source spans",
      );
      assert.ok(
        await page
          .locator(`${source} p`)
          .nth(1)
          .evaluate((element) => parseFloat(getComputedStyle(element).marginTop) > 0),
        "ordinary paragraphs retain readable spacing",
      );
      if (viewport.width === 390)
        assert.equal(
          await blocks
            .getByRole("region", { name: "Message table" })
            .evaluate((element) => element.scrollWidth > element.clientWidth),
          true,
        );
      await blocks
        .getByRole("region", { name: "Message table" })
        .screenshot({ path: `${out}/${engine.name()}-${viewport.width}-table.png` });
      assert.equal(
        await blocks
          .locator("pre")
          .evaluate((element) => element.scrollWidth > element.clientWidth),
        true,
      );
      await blocks
        .getByTestId("chat-code-block")
        .screenshot({ path: `${out}/${engine.name()}-${viewport.width}-code.png` });
      const userBlocks = page.locator('[data-message-id="u2"]');
      assert.equal(await userBlocks.locator("h3").innerText(), "User formatting");
      assert.equal(await userBlocks.locator("table").count(), 1);
      assert.equal(await userBlocks.getByRole("checkbox").isDisabled(), true);
      for (const quote of [
        "Nested detail",
        "Second quoted line",
        "Implemented",
        "const value",
        "After the code toolbar.",
        "final cell",
      ]) {
        const start = blockText.indexOf(quote);
        await select(blockSource, start, start + quote.length, touch);
        await openComment();
        assert.equal(
          await page
            .getByRole("dialog", { name: "Comment on passage" })
            .locator("blockquote")
            .textContent(),
          quote,
        );
        await comment.press("Escape");
      }
      const blockStart = blockText.indexOf("Implementation notes");
      const blockEnd = blockText.indexOf("final cell") + "final cell".length;
      await select(blockSource, blockStart, blockEnd, touch);
      await openComment();
      assert.equal(
        await page
          .getByRole("dialog", { name: "Comment on passage" })
          .locator("blockquote")
          .textContent(),
        blockText.slice(blockStart, blockEnd),
        "cross-block quotes exclude controls and keep raw offsets",
      );
      await save("Block feedback");
      await page.keyboard.press("Escape");
      const tableMark = blocks.locator("td mark").last();
      await activate(tableMark);
      assert.equal(await comment.inputValue(), "Block feedback");
      await page.getByRole("button", { name: "Delete comment", exact: true }).click();
      await blocks.locator("h2").scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${out}/${engine.name()}-${viewport.width}-markdown.png` });
      await assertLayout();
      const formattedSource = '[data-annotation-source="a3"]';
      const formattedText = messages[5].text;
      assert.equal(await page.locator(formattedSource).textContent(), formattedText);
      assert.equal(
        await page.locator(formattedSource).innerText(),
        "Before Open the app → http://100.71.229.1:41227 then main and Docs.",
        "Markdown delimiters and destinations are not visible or copied",
      );
      assert.equal(await page.locator(`${formattedSource} a`).count(), 2);
      assert.equal(await page.locator(`${formattedSource} a a`).count(), 0);
      for (const quote of ["Open the app", "main", "Docs"]) {
        const start = formattedText.indexOf(quote);
        await select(formattedSource, start, start + quote.length, touch);
        await action.waitFor();
        assert.equal(await page.evaluate(() => window.getSelection().toString()), quote);
        await openComment();
        assert.equal(
          await page
            .getByRole("dialog", { name: "Comment on passage" })
            .locator("blockquote")
            .textContent(),
          quote,
          "selection after hidden syntax retains its original source offsets",
        );
        await comment.press("Escape");
      }
      const acrossStart = formattedText.indexOf("Open the app");
      const acrossEnd = formattedText.indexOf("main") + 4;
      await select(formattedSource, acrossStart, acrossEnd, touch);
      await openComment();
      assert.equal(
        await page
          .getByRole("dialog", { name: "Comment on passage" })
          .locator("blockquote")
          .textContent(),
        formattedText.slice(acrossStart, acrossEnd),
        "cross-format annotations keep the original Markdown quote",
      );
      await comment.press("Escape");
      await select(formattedSource, acrossStart, acrossEnd, touch);
      await openComment();
      await save("Formatted passage feedback.");
      const linkedHighlight = page.locator(`${formattedSource} a mark`).first();
      const pageCount = browser
        .contexts()
        .reduce((count, context) => count + context.pages().length, 0);
      await activate(linkedHighlight);
      assert.equal(await comment.inputValue(), "Formatted passage feedback.");
      assert.equal(
        await page
          .getByRole("dialog", { name: "Edit comment", exact: true })
          .locator("blockquote")
          .textContent(),
        formattedText.slice(acrossStart, acrossEnd),
      );
      assert.equal(
        browser.contexts().reduce((count, context) => count + context.pages().length, 0),
        pageCount,
        "editing a highlighted link does not navigate",
      );
      await page.getByRole("button", { name: "Delete comment", exact: true }).click();
      assert.equal(
        await generalAction.count(),
        0,
        "removing the last comment hides general feedback",
      );
      if (touch) {
        // iPad native selection handles need not emit any pointer events.
        await select(source, 0, 30, null);
        await action.waitFor();
        assert.equal(
          await page.getByTestId("annotation-selection-dock").count(),
          0,
          "touch entry stays beside the text, not docked",
        );
        assert.equal(await comment.count(), 0);
        assert.equal(
          await page.evaluate(() => window.getSelection().toString()),
          messages[3].text.slice(0, 30),
        );
        await page.keyboard.press("Escape");
        await action.waitFor({ state: "hidden" });
      }
      await select(source, 0, 30);
      await action.waitFor();
      assert.equal(await comment.count(), 0, "selecting reveals an action, not an editor");
      assert.equal(
        await action.evaluate((button) => button === document.activeElement),
        false,
        "selection does not steal focus",
      );
      assert.equal(
        await page.evaluate(() => window.getSelection().toString()),
        messages[3].text.slice(0, 30),
      );
      await page.keyboard.press("Control+c");
      assert.equal(
        await page.evaluate(() => window.getSelection().toString()),
        messages[3].text.slice(0, 30),
        "copy selection stays intact",
      );
      await page.locator("#agent-prompt").click();
      await action.waitFor({ state: "hidden" });
      await select(source, 0, 30);
      await action.waitFor();
      await page.keyboard.press("Escape");
      await action.waitFor({ state: "hidden" });
      await select(source, 0, 30);
      await action.waitFor();
      // A view change must not resurrect a range from a detached transcript.
      await page
        .getByRole("button", { name: "Switch to Terminal view" })
        .evaluate((button) => button.click());
      await page.getByRole("button", { name: "Switch to Chat view" }).click();
      await page.locator(source).waitFor();
      assert.equal(await action.count(), 0);
      await select('[data-testid="chat-transcript"] article:first-of-type p', 0, 20);
      assert.equal(await action.count(), 0, "user messages cannot be annotated");
      await page.getByTestId("chat-tool").locator("summary").click();
      await select('[data-testid="chat-tool"] pre', 0, 10);
      assert.equal(await action.count(), 0, "tool output cannot be annotated");
      await page.getByTestId("chat-tool").locator("summary").click();
      await page.evaluate(() => {
        const range = document.createRange();
        range.setStart(document.querySelector('[data-annotation-source="a1"] p').firstChild, 0);
        range.setEnd(document.querySelector('[data-annotation-source="a2"] p').firstChild, 2);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        document.dispatchEvent(
          new PointerEvent("pointerup", { bubbles: true, pointerType: "mouse" }),
        );
      });
      assert.equal(await action.count(), 0, "cross-message selections are rejected");
      await page.locator("#agent-prompt").fill("Keep my ordinary draft");
      const passageStart = messages[3].text.indexOf("The phone view");
      await select(
        source,
        passageStart,
        passageStart + "The phone view remains focused on one task.".length,
        touch,
      );
      await action.waitFor();
      assert.equal(await comment.count(), 0, "touch and mouse selection leave the editor closed");
      // Headless WebKit cannot show iPad system chrome. Reserve its below-selection
      // menu footprint from the reported screenshot to catch app-button collisions.
      if (touch) {
        assert.equal(await page.getByTestId("annotation-selection-dock").count(), 0);
        assert.equal(await page.locator("[data-ui=annotation-action]").count(), 1);
        assert.equal(
          await action.evaluate((button) => getComputedStyle(button.parentElement).position),
          "fixed",
        );
        const distance = await action.evaluate((button) => {
          const action = button.getBoundingClientRect();
          const selection = window.getSelection().getRangeAt(0).getBoundingClientRect();
          const dx = Math.max(selection.left - action.right, action.left - selection.right, 0);
          const dy = Math.max(selection.top - action.bottom, action.top - selection.bottom, 0);
          return Math.hypot(dx, dy);
        });
        assert.ok(distance <= 90, "Comment remains anchored near the selected passage");
        await page.evaluate(() => {
          const rect = window.getSelection().getRangeAt(0).getBoundingClientRect();
          const menu = document.createElement("div");
          menu.dataset.testid = "native-selection-menu-fixture";
          const width = Math.min(450, innerWidth - 24);
          Object.assign(menu.style, {
            position: "fixed",
            zIndex: "2147483647",
            left: `${Math.max(12, Math.min(rect.left, innerWidth - width - 12))}px`,
            top: `${rect.bottom + 12}px`,
            width: `${width}px`,
            height: "44px",
            borderRadius: "22px",
            background: "#f0f0f0",
            color: "#222",
            display: "grid",
            placeItems: "center",
            font: "15px sans-serif",
          });
          menu.textContent = "Copy     Search     Translate";
          document.body.append(menu);
        });
        for (const side of ["above", "below"]) {
          await page.getByTestId("native-selection-menu-fixture").evaluate((menu, side) => {
            const rect = window.getSelection().getRangeAt(0).getBoundingClientRect();
            menu.style.top = `${side === "below" ? rect.bottom + 12 : rect.top - 56}px`;
          }, side);
          assert.equal(
            await action.evaluate((button) => {
              const rect = button.getBoundingClientRect();
              const menu = document
                .querySelector("[data-testid=native-selection-menu-fixture]")
                .getBoundingClientRect();
              return (
                rect.right <= menu.left ||
                rect.left >= menu.right ||
                rect.bottom <= menu.top ||
                rect.top >= menu.bottom
              );
            }),
            true,
            `The ${side}-selection native-menu footprint must not cover Comment`,
          );
        }
      }
      await page.screenshot({ path: `${out}/${engine.name()}-${viewport.width}-selection.png` });
      await openComment();
      await page
        .getByTestId("native-selection-menu-fixture")
        .evaluateAll((menus) => menus.forEach((menu) => menu.remove()));
      assert.equal(
        await comment.evaluate((input) => input === document.activeElement),
        true,
        "explicit activation focuses the editor",
      );
      await comment.fill("Keep the status visible on smaller screens, too.");
      await assertLayout();
      await page.screenshot({ path: `${out}/${engine.name()}-${viewport.width}-popover.png` });
      await comment.press("Enter");
      await comment.waitFor({ state: "hidden" });
      assert.ok(await page.locator(`${source} mark`).count());
      assert.equal(await action.count(), 0, "saving dismisses the contextual action");
      assert.equal(await generalAction.count(), 1);
      assert.equal(await tray.getByRole("button", { name: /Edit latest comment:/ }).count(), 0);
      assert.equal(
        await tray
          .getByText("Keep the status visible on smaller screens, too.", { exact: true })
          .count(),
        0,
        "collapsed tray has no comment preview",
      );
      const highlight = page.locator(`${source} mark`).first();
      await activate(highlight);
      assert.equal(await comment.inputValue(), "Keep the status visible on smaller screens, too.");
      await save("Keep the status visible on every screen.");
      await highlight.focus();
      await highlight.press("Enter");
      assert.equal(await comment.inputValue(), "Keep the status visible on every screen.");
      await comment.press("Escape");
      await page.getByRole("button", { name: "Switch to Terminal view" }).click();
      await page.getByRole("button", { name: "Switch to Chat view" }).click();
      assert.equal(await tray.count(), 1, "terminal switch preserves comments");
      await select('[data-annotation-source="a2"]', 4, 44);
      await openComment();
      await save("Use the new layout reference.");
      // Selection over a saved highlight remains passive, and overlapping
      // highlights edit the latest matching comment without losing the older one.
      await select('[data-annotation-source="a2"]', 8, 25, touch);
      await action.waitFor();
      assert.equal(await comment.count(), 0);
      await openComment();
      await save("Overlapping feedback.");
      await activate(
        page
          .locator('[data-annotation-source="a2"] mark')
          .filter({ hasText: messages[4].text.slice(8, 25) })
          .first(),
      );
      assert.equal(await comment.inputValue(), "Overlapping feedback.");
      await page.getByRole("button", { name: "Delete comment", exact: true }).click();
      await activate(generalAction);
      await save("Also consider keyboard accessibility.");
      await tray.getByRole("button", { name: /3 pending comments/ }).click();
      await activate(tray.getByRole("button", { name: /Edit text of comment 1:/ }));
      await save("Keep the status visible on every screen.");
      await page.screenshot({ path: `${out}/${engine.name()}-${viewport.width}-tray.png` });
      await assertLayout();
      assert.equal(sends.length, 0, "saving comments never sends a prompt");
      await update({ busy: true });
      // SSE fixture delivery schedules a React update; wait for that commit,
      // rather than reading the previous render's button state on fast browsers.
      await page.getByRole("button", { name: "Stop", exact: true }).waitFor();
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
      // Integration with the skills composer must not couple comment sending to
      // ordinary text, attachments, or an unavailable /skill: invocation.
      await page.locator("#agent-prompt").fill("/skill:unavailable Keep my ordinary draft");
      assert.equal(
        await page.getByRole("button", { name: "Send message", exact: true }).isDisabled(),
        true,
      );
      assert.equal(
        await tray.getByRole("button", { name: "Send comments", exact: true }).isEnabled(),
        true,
      );
      await page.locator("#agent-prompt").fill("");
      assert.equal(
        await tray.getByRole("button", { name: "Send comments", exact: true }).isEnabled(),
        true,
      );
      await page.locator("#agent-prompt").fill("Keep my ordinary draft");
      failure = true;
      await tray.getByRole("button", { name: "Send comments", exact: true }).click();
      await tray.getByRole("alert").waitFor();
      assert.equal(sends.length, 1);
      assert.match(sends[0].text, /Keep the status visible on every screen/);
      assert.match(sends[0].text, /response a2/);
      assert.match(
        sends[0].text,
        /\*\*Comment 3\*\* \(general comment\)\n\nAlso consider keyboard accessibility\./,
      );
      assert.doesNotMatch(sends[0].text, /undefined/);
      assert.match(sends[0].text, /\*\*Comment 1\*\*/);
      assert.doesNotMatch(sends[0].text, /### Comment/);
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
      assert.equal(
        await tray.getByRole("button", { name: "Edit comment 1", exact: true }).isDisabled(),
        true,
      );
      assert.equal(await generalAction.isDisabled(), true);
      assert.equal(
        await page.locator(`${source} mark[role="button"]`).count(),
        0,
        "highlight editing is locked during forwarding",
      );
      assert.equal(
        await tray.getByRole("button", { name: /Edit text of comment 1:/ }).isDisabled(),
        true,
      );
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
      await update({
        messages: [...messages, { id: "feedback", role: "user", text: sends[1].text }],
      });
      const label = page
        .getByTestId("chat-transcript")
        .locator("strong")
        .filter({ hasText: /^Comment 1$/ });
      await label.waitFor();
      assert.equal(
        await label.count(),
        1,
        "sent labels render in actual bold, not literal Markdown",
      );
      // Selecting a whole response is supported without any permanent control.
      await select(source, 0, messages[3].text.length);
      await action.waitFor();
      await page.keyboard.press("Tab");
      assert.equal(await action.evaluate((button) => button === document.activeElement), true);
      await page.keyboard.press("Enter");
      await comment.waitFor();
      await comment.press("Escape");
      assert.equal(await tray.count(), 0);
      await select(source, 0, messages[3].text.length);
      await action.waitFor();
      await page.keyboard.press("Alt+Enter");
      await comment.waitFor();
      await comment.fill("first line");
      await comment.dispatchEvent("keydown", { key: "Enter", isComposing: true });
      assert.equal(await comment.count(), 1, "IME confirmation is not comment submission");
      await comment.press("Shift+Enter");
      await comment.press("a");
      assert.match(await comment.inputValue(), /\n/);
      await comment.press("Enter");
      const review = tray.getByRole("button", { name: /1 pending comment/ });
      if ((await review.getAttribute("aria-expanded")) !== "true") await review.click();
      await activate(tray.getByRole("button", { name: /Edit text of comment 1:/ }));
      await page.getByRole("button", { name: "Delete comment", exact: true }).click();
      await tray.waitFor({ state: "hidden" });
      await select(source, 0, 30);
      await openComment();
      await save("Do not send this into a replacement session.");
      await update({ epoch: "a0000000-0000-4000-8000-000000000003" });
      await tray.getByRole("button", { name: "Discard old comments" }).waitFor();
      assert.equal(
        await tray.getByRole("button", { name: "Send comment", exact: true }).isDisabled(),
        true,
      );
      assert.equal(sends.length, 2);
      assert.equal(await generalAction.isDisabled(), true);
      await tray.getByRole("button", { name: "Discard old comments" }).click();
      await tray.waitFor({ state: "hidden" });
      assert.equal(await generalAction.count(), 0);
      // Existing general feedback remains sendable if its passage comment is
      // removed, but adding it always requires a batch to have been started.
      await select(source, 0, 30);
      await openComment();
      await save("Temporary passage comment.");
      await activate(generalAction);
      await save("General feedback only.");
      await activate(page.locator(`${source} mark`).first());
      await page.getByRole("button", { name: "Delete comment", exact: true }).click();
      await tray.getByRole("button", { name: "Send comment", exact: true }).click();
      await tray.waitFor({ state: "hidden" });
      assert.equal(sends.length, 3);
      assert.match(
        sends[2].text,
        /\*\*Comment 1\*\* \(general comment\)\n\nGeneral feedback only\./,
      );
      assert.doesNotMatch(sends[2].text, /response |characters |\n> |undefined/);
      assert.equal(await page.locator("#agent-prompt").inputValue(), "Keep my ordinary draft");
      await update({
        messages: [...messages, { id: "general-feedback", role: "user", text: sends[2].text }],
      });
      await label.waitFor();
      assert.equal(await label.count(), 1, "general feedback labels render in bold");
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
