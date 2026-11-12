// Synthetic integration fixture: no Herdr/Pi sockets or production agents are contacted.
// npm run build && node tools/design/flow-whiteboard.mjs
import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, webkit } from "playwright";
import { createHttpServer } from "../../dist-server/server/http/server.js";
import { defaultFlowProps } from "../../dist-server/packages/pi-live-chat/flowProtocol.js";

const target = {
  runtime: "b0000000-0000-4000-8000-000000000001",
  epoch: "b0000000-0000-4000-8000-000000000002",
  sessionId: "flow-fixture",
};
const agent = {
  agent: "pi",
  name: "Planner",
  pane_id: "w1:p1",
  tab_id: "w1:t1",
  workspace_id: "w1",
  agent_status: "idle",
  revision: 1,
  focused: false,
  agent_session: { agent: "pi", kind: "path", source: "fixture", value: "/flow-fixture.jsonl" },
};
const snapshot = {
  type: "snapshot",
  version: 2,
  identity: {
    ...target,
    pid: 1,
    processStart: "1",
    pane: agent.pane_id,
    herdrSocket: "/fixture.sock",
    sessionFile: "/flow-fixture.jsonl",
  },
  epoch: target.epoch,
  seq: 1,
  busy: false,
  sendPending: false,
  truncated: false,
  capabilities: { boards: true },
  messages: [
    { id: "u", role: "user", text: "Sketch our service architecture." },
    {
      id: "a",
      role: "assistant",
      text: "I can use structured components and read your annotations.",
    },
  ],
  status: { cwd: "/fixture", totalTokens: 0, cost: 0 },
};
const component = (id, title, x = 0) => ({
  id,
  type: "component",
  kind: "card",
  x,
  y: 0,
  width: 300,
  height: 160,
  version: 1,
  parentId: null,
  props: { ...defaultFlowProps("card"), title, body: "Editable component props" },
});
const initial = () => ({
  id: "b".repeat(64),
  revision: 0,
  updatedAt: 1,
  lastAuthor: "human",
  snapshots: [],
  access: null,
  scene: {
    engine: "react-flow",
    elements: [component("service", "User service"), component("database", "Database", 450)],
    files: {},
    background: "#ffffff",
  },
});
async function until(predicate, description) {
  const limit = Date.now() + 10000;
  while (!predicate()) {
    if (Date.now() > limit) throw new Error(`Timed out: ${description}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
const server = createHttpServer(
  { getDashboard: async () => ({ agents: [], tabs: [], workspaces: [] }) },
  resolve("dist"),
  {},
);
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
await mkdir(".runtime/flow-board-evidence", { recursive: true });
try {
  for (const [name, engine] of [
    ["chromium", chromium],
    ["webkit", webkit],
  ]) {
    const browser = await engine.launch();
    try {
      for (const [layout, viewport] of [
        ["desktop", { width: 1440, height: 1000 }],
        ["landscape", { width: 1194, height: 834 }],
        ["portrait", { width: 834, height: 1194 }],
        ["phone", { width: 390, height: 844 }],
      ]) {
        const context = await browser.newContext({
          viewport,
          hasTouch: layout !== "desktop",
          serviceWorkers: "block",
          acceptDownloads: true,
        });
        const page = await context.newPage();
        const errors = [];
        page.on("pageerror", (e) => errors.push(e.message));
        let board = initial();
        let releaseOpen;
        const initialOpen = new Promise((resolve) => {
          releaseOpen = resolve;
        });
        let failOpen = true;
        const saves = [];
        const prompts = [];
        let failSaves = false;
        let failExports = false;
        const exports = [];
        await page.addInitScript(
          ({ snapshot }) => {
            window.fixtureSources = [];
            window.EventSource = class {
              constructor(url) {
                this.url = String(url);
                window.fixtureSources.push(this);
                if (!this.url.includes("/board/"))
                  this.timer = setTimeout(
                    () => this.onmessage?.({ data: JSON.stringify(snapshot) }),
                    20,
                  );
              }
              close() {
                clearTimeout(this.timer);
                window.fixtureSources = window.fixtureSources.filter((source) => source !== this);
              }
            };
            window.flowChanged = (revision) =>
              window.fixtureSources
                .filter((source) => source.url.includes("/board/"))
                .forEach((source) =>
                  source.onmessage?.({
                    data: JSON.stringify({
                      type: "changed",
                      revision,
                      access: null,
                      lastAuthor: "agent",
                    }),
                  }),
                );
          },
          { snapshot },
        );
        await page.route("**/*", async (route) => {
          const request = route.request();
          const url = new URL(request.url());
          if (url.origin !== origin) return route.abort();
          if (!url.pathname.startsWith("/api/")) return route.continue();
          if (url.pathname === "/api/agents")
            return route.fulfill({
              json: {
                agents: [agent],
                tabs: [],
                workspaces: [{ workspace_id: "w1", label: "Flow fixture" }],
              },
            });
          if (url.pathname.endsWith("/board")) {
            await initialOpen;
            return failOpen
              ? route.fulfill({ status: 503, json: { error: "Fixture unavailable" } })
              : route.fulfill({ json: board });
          }
          if (url.pathname.endsWith("/board/save")) {
            const input = request.postDataJSON();
            saves.push(input);
            if (failSaves)
              return route.fulfill({ status: 500, json: { error: "Fixture storage unavailable" } });
            if (input.baseRevision !== board.revision)
              return route.fulfill({
                status: 409,
                json: { error: "Board changed", code: "board_stale" },
              });
            board = {
              ...board,
              scene: input.scene,
              revision: board.revision + 1,
              lastAuthor: "human",
              updatedAt: Date.now(),
            };
            return route.fulfill({ json: board });
          }
          if (url.pathname.endsWith("/board/export")) {
            exports.push(request.postDataJSON());
            if (failExports)
              return route.fulfill({
                status: 503,
                json: { error: "Fixture renderer unavailable" },
              });
            return route.fulfill({
              contentType: "image/png",
              body: Buffer.from(
                "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
                "base64",
              ),
            });
          }
          if (url.pathname.endsWith("/prompt")) {
            const input = request.postDataJSON();
            prompts.push(input);
            return route.fulfill({
              json: { type: "ack", id: input.requestId, outcome: "invoked" },
            });
          }
          if (url.pathname.endsWith("/board/revoke")) return route.fulfill({ json: { ok: true } });
          return route.fulfill({
            status: 404,
            json: { error: `Unmocked fixture request ${url.pathname}` },
          });
        });
        await page.goto(origin + "/?pane=w1%3Ap1&session=flow-fixture&whiteboard=1");
        const whiteboard = page.getByTestId("whiteboard");
        await whiteboard.getByText("Loading whiteboard", { exact: true }).waitFor();
        assert.equal(await whiteboard.getByText("Saved", { exact: true }).count(), 0);
        assert(await whiteboard.getByRole("button", { name: "← Back", exact: true }).isEnabled());
        await page.screenshot({
          path: `.runtime/flow-board-evidence/loading-${name}-${layout}.png`,
        });
        releaseOpen();
        await whiteboard.getByText("Offline", { exact: true }).waitFor();
        assert.equal(await whiteboard.getByText("Loading whiteboard", { exact: true }).count(), 0);
        failOpen = false;
        await whiteboard.getByRole("button", { name: "Reconnect board", exact: true }).click();
        await page.getByTestId("flow-board-editor").waitFor();
        await whiteboard.getByText("Saved", { exact: true }).waitFor();
        assert.equal(
          await page.getByTestId("flow-board-editor").locator(":scope > header").count(),
          0,
        );
        assert.equal(
          await whiteboard.getByRole("complementary", { name: "Component library" }).count(),
          0,
        );
        const toggle = whiteboard.getByRole("button", { name: "Expand conversation", exact: true });
        assert(
          await toggle.evaluate((button) => {
            const header = button.parentElement,
              box = button.getBoundingClientRect();
            return (
              Math.abs(
                box.left -
                  header.getBoundingClientRect().left -
                  parseFloat(getComputedStyle(header).paddingLeft),
              ) < 2 &&
              box.width >= 44 &&
              box.height >= 44
            );
          }),
        );
        assert.equal(await whiteboard.getByText("Reply ready", { exact: true }).count(), 0);
        await toggle.click();
        await whiteboard
          .getByRole("button", { name: "Collapse conversation", exact: true })
          .click();
        const fit = whiteboard.getByRole("button", { name: "Fit drawing", exact: true });
        const map = whiteboard.locator(".react-flow__minimap");
        if (await map.isVisible()) {
          const m = await map.boundingBox(),
            f = await fit.boundingBox();
          assert(
            Math.abs(m.x - f.x - f.width - 12) < 2 && Math.abs(m.y + m.height - f.y - f.height) < 2,
            `Fit drawing is bottom-aligned 12px left of minimap: ${JSON.stringify({ m, f, css: await map.evaluate((el) => ({ position: getComputedStyle(el).position, bottom: getComputedStyle(el).bottom, margin: getComputedStyle(el).margin })) })}`,
          );
        }
        const add = whiteboard.getByRole("button", { name: "Add a component", exact: true });
        assert.equal(
          await add.evaluate((el) => getComputedStyle(el).backgroundColor),
          "rgb(255, 255, 255)",
        );
        assert(
          await add.evaluate((el) =>
            Boolean(
              document.querySelector('[aria-label="Pen width"]').compareDocumentPosition(el) &
              Node.DOCUMENT_POSITION_FOLLOWING,
            ),
          ),
        );
        await add.click();
        const picker = page.getByRole("dialog", { name: "Add a component", exact: true });
        await picker.waitFor();
        assert.equal(await add.getAttribute("aria-expanded"), "true");
        assert.equal(
          await add.evaluate((el) => getComputedStyle(el).backgroundColor),
          await whiteboard
            .getByRole("button", { name: "Select", exact: true })
            .evaluate((el) => getComputedStyle(el).backgroundColor),
        );
        await page.screenshot({
          path: `.runtime/flow-board-evidence/picker-${name}-${layout}.png`,
        });
        await picker.getByRole("textbox", { name: "Find a component" }).fill("card");
        await picker.getByRole("button", { name: "Add Card", exact: true }).click();
        await page.getByRole("dialog", { name: "Add Card", exact: true }).waitFor();
        await page.keyboard.press("Escape");
        await page.waitForFunction(
          () => document.activeElement?.getAttribute("aria-label") === "Add a component",
        );
        // Manual edit is durably saved before a prompt is forwarded.
        await page.getByTestId("component-service").dblclick({ position: { x: 100, y: 25 } });
        let editor = page.getByRole("dialog", { name: "Edit Card", exact: true });
        assert.equal(
          await editor
            .getByText("These are React components, not flattened drawings.", { exact: true })
            .count(),
          0,
        );
        assert.equal(await editor.getByText("Up to 2 MiB", { exact: true }).count(), 1);
        assert(
          await editor
            .locator("textarea")
            .evaluateAll((elements) =>
              elements.every((e) => getComputedStyle(e).resize === "none"),
            ),
        );
        const customColor = editor.getByLabel("Custom accent color", { exact: true });
        const customSwatch = customColor.locator("..");
        assert.equal((await customSwatch.textContent()).trim(), "");
        assert.equal(await customSwatch.locator("svg").count(), 1);
        const customBox = await customSwatch.boundingBox();
        const swatchBox = await editor
          .getByRole("button", { name: "Use #f28b3c", exact: true })
          .boundingBox();
        assert.equal(customBox.width, swatchBox.width);
        assert.equal(customBox.height, swatchBox.height);
        assert.equal(await customSwatch.evaluate((e) => getComputedStyle(e).borderRadius), "50%");
        assert(
          await customColor.evaluate((e) => {
            const box = e.getBoundingClientRect();
            return document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2) === e;
          }),
        );
        await page.screenshot({
          path: `.runtime/flow-board-evidence/editor-${name}-${layout}.png`,
        });
        await editor.getByLabel("Title", { exact: true }).fill("Human service title");
        await editor.getByRole("button", { name: "Save changes", exact: true }).click();
        await until(
          () =>
            board.scene.elements.some(
              (e) => e.id === "service" && e.props?.title === "Human service title",
            ),
          "component autosave",
        );
        // The current outer whiteboard keeps normal chat and all message history.
        const composer = whiteboard.getByRole("textbox", { name: /message/i });
        await composer.fill("Connect the service to its database.");
        await composer.press("Control+Enter");
        await until(() => prompts.length === 1, "save-before-prompt");
        assert.equal(prompts[0].revision, board.revision);
        assert.equal(prompts[0].boardId, board.id);
        assert.equal(prompts[0].text, "Connect the service to its database.");
        // Remote structured edits become visible without erasing the human's props.
        board = {
          ...board,
          revision: board.revision + 1,
          lastAuthor: "agent",
          scene: {
            ...board.scene,
            elements: [...board.scene.elements, component("agent-card", "Agent-added card", 850)],
          },
        };
        await page.evaluate((revision) => window.flowChanged(revision), board.revision);
        await page.getByTestId("component-agent-card").waitFor();
        assert.equal(
          board.scene.elements.find((e) => e.id === "service").props.title,
          "Human service title",
        );
        // One drag is one saved undo step in both Chromium and WebKit. The
        // unrelated incoming agent card and the earlier human title survive.
        const originalPosition = board.scene.elements.find((e) => e.id === "service");
        const originalX = originalPosition.x,
          originalY = originalPosition.y;
        const movingBox = await page.getByTestId("component-service").boundingBox();
        await page.mouse.move(movingBox.x + movingBox.width / 2, movingBox.y + 15);
        await page.mouse.down();
        await page.mouse.move(movingBox.x + movingBox.width / 2 + 45, movingBox.y + 45, {
          steps: 10,
        });
        await page.mouse.up();
        await until(
          () => board.scene.elements.find((e) => e.id === "service").x !== originalX,
          "component move autosave",
        );
        const movedX = board.scene.elements.find((e) => e.id === "service").x;
        await page.getByRole("button", { name: "Undo", exact: true }).click();
        await until(
          () => board.scene.elements.find((e) => e.id === "service").x === originalX,
          "saved component move undo",
        );
        assert.equal(board.scene.elements.find((e) => e.id === "service").y, originalY);
        assert(board.scene.elements.some((e) => e.id === "agent-card" && !e.isDeleted));
        await page.getByRole("button", { name: "Redo", exact: true }).click();
        await until(
          () => board.scene.elements.find((e) => e.id === "service").x === movedX,
          "saved component move redo",
        );
        await page.getByRole("button", { name: "Undo", exact: true }).click();
        await until(
          () => board.scene.elements.find((e) => e.id === "service").x === originalX,
          "restore component position",
        );
        assert.equal(
          board.scene.elements.find((e) => e.id === "service").props.title,
          "Human service title",
        );
        // Drawing is persisted in the same native scene as components.
        await page.getByRole("button", { name: "Draw", exact: true }).click();
        const surface = await page.getByTestId("ink-surface").boundingBox();
        await page.mouse.move(surface.x + 50, surface.y + 150);
        await page.mouse.down();
        await page.mouse.move(surface.x + 100, surface.y + 170, { steps: 12 });
        await page.mouse.up();
        await until(
          () => board.scene.elements.some((e) => e.type === "ink" && !e.isDeleted),
          "ink autosave",
        );
        await page.getByRole("button", { name: "Undo", exact: true }).click();
        await until(
          () => board.scene.elements.some((e) => e.type === "ink" && e.isDeleted),
          "saved drawing undo",
        );
        await page.getByRole("button", { name: "Redo", exact: true }).click();
        await until(
          () => board.scene.elements.some((e) => e.type === "ink" && !e.isDeleted),
          "saved drawing redo",
        );
        await page.getByRole("button", { name: "Select", exact: true }).click();
        await page.screenshot({ path: `.runtime/flow-board-evidence/${name}-${layout}.png` });
        // Max-sized tables stay inside their editor; cancel preserves the board.
        const table = {
          ...component("large-table", "Large table", 1800),
          kind: "table",
          width: 500,
          height: 300,
          props: {
            ...defaultFlowProps("table"),
            title: "Large table",
            columns: Array.from({ length: 20 }, (_, i) => `Column ${i + 1}`),
            rows: Array.from({ length: 100 }, () =>
              Array(20).fill("Long cell content ".repeat(12)),
            ),
          },
        };
        board = {
          ...board,
          revision: board.revision + 1,
          scene: { ...board.scene, elements: [...board.scene.elements, table] },
        };
        await page.evaluate((revision) => window.flowChanged(revision), board.revision);
        await page.getByTestId("component-large-table").waitFor();
        await fit.click();
        await page.screenshot({
          path: `.runtime/flow-board-evidence/table-canvas-${name}-${layout}.png`,
        });
        await page.getByTestId("component-large-table").dblclick({ position: { x: 30, y: 15 } });
        const tableEditor = page.getByRole("dialog", { name: "Edit Table Node", exact: true });
        await tableEditor.waitFor();
        assert.equal(
          await tableEditor
            .getByRole("textbox", { name: "Row 100 column 20", exact: true })
            .count(),
          1,
        );
        assert(
          await tableEditor.evaluate((el) => {
            const table = el.querySelector("table"),
              region = table.parentElement;
            return (
              region.scrollWidth > region.clientWidth &&
              el.getBoundingClientRect().right <= innerWidth &&
              document.documentElement.scrollWidth <= innerWidth
            );
          }),
          "Large table overflow stays inside the editor",
        );
        for (const label of ["Cancel", "Save changes"]) {
          const button = tableEditor.getByRole("button", { name: label, exact: true });
          await button.scrollIntoViewIfNeeded();
          const box = await button.boundingBox();
          assert(
            box.y >= 0 && box.y + box.height <= viewport.height,
            "Editor actions stay reachable",
          );
        }
        await page.screenshot({ path: `.runtime/flow-board-evidence/table-${name}-${layout}.png` });
        await tableEditor.getByRole("button", { name: "Cancel", exact: true }).click();
        board = {
          ...board,
          revision: board.revision + 1,
          scene: {
            ...board.scene,
            elements: board.scene.elements.filter((e) => e.id !== "large-table"),
          },
        };
        await page.evaluate((revision) => window.flowChanged(revision), board.revision);
        await page.getByTestId("component-large-table").waitFor({ state: "detached" });
        await fit.click();
        // A failed/uncertain write retains a recoverable local draft across reload.
        failSaves = true;
        await page.getByTestId("component-service").dblclick({ position: { x: 30, y: 15 } });
        editor = page.getByRole("dialog", { name: "Edit Card", exact: true });
        await editor.getByLabel("Title", { exact: true }).fill("Unsynced local title");
        await editor.getByRole("button", { name: "Save changes", exact: true }).click();
        await whiteboard
          .getByText(/Autosave paused/)
          .first()
          .waitFor();
        assert.equal(await whiteboard.getByText("Saved", { exact: true }).count(), 0);
        await whiteboard.getByText("Unsynced", { exact: true }).waitFor();
        const count = saves.length;
        await page.reload();
        // The one-shot deep link is consumed; reopen normally, like a user.
        await page.getByRole("button", { name: "Open whiteboard", exact: true }).click();
        await page.getByTestId("flow-board-editor").waitFor();
        await page
          .getByTestId("component-service")
          .getByText("Unsynced local title", { exact: true })
          .waitFor();
        await whiteboard
          .getByText(/Autosave paused/)
          .first()
          .waitFor();
        assert.equal(saves.length, count, "uncertain writes must not replay on reload");
        assert.equal(
          board.scene.elements.find((e) => e.id === "service").props.title,
          "Human service title",
        );
        // Independent JSON/PNG downloads capture the local paused draft, not an older saved board.
        const beforeExports = saves.length;
        assert.equal(
          await whiteboard.getByRole("button", { name: "Export", exact: true }).count(),
          0,
        );
        const downloadButton = whiteboard.getByRole("button", { name: "Download", exact: true });
        await downloadButton.click();
        const exportDialog = page.getByRole("menu", { name: "Download board", exact: true });
        await exportDialog.waitFor();
        const menuBox = await exportDialog.boundingBox();
        assert(
          menuBox.x >= 0 &&
            menuBox.y >= 0 &&
            menuBox.x + menuBox.width <= viewport.width &&
            menuBox.y + menuBox.height <= viewport.height,
          "download menu must fit the viewport",
        );
        await page.waitForFunction(
          () => document.activeElement?.getAttribute("role") === "menuitem",
        );
        await page.keyboard.press("ArrowDown");
        assert(
          await exportDialog
            .getByRole("menuitem", { name: "Download PNG", exact: true })
            .evaluate((el) => el === document.activeElement),
        );
        await page.keyboard.press("Home");
        await page.screenshot({
          path: `.runtime/flow-board-evidence/export-${name}-${layout}.png`,
        });
        const jsonDownloadPromise = page.waitForEvent("download");
        await exportDialog.getByRole("menuitem", { name: "Download JSON", exact: true }).click();
        const jsonDownload = await jsonDownloadPromise;
        assert.equal(jsonDownload.suggestedFilename(), "whiteboard.flow.json");
        const backup = JSON.parse(await readFile(await jsonDownload.path(), "utf8"));
        assert.equal(backup.format, "fernblick-flow");
        assert.equal(
          backup.scene.elements.find((e) => e.id === "service").props.title,
          "Unsynced local title",
        );
        assert.equal(exports.length, 0, "JSON download must not request or bundle PNG");
        await exportDialog.waitFor({ state: "detached" });
        assert.equal(await downloadButton.getAttribute("aria-expanded"), "false");
        await downloadButton.click();
        failExports = true;
        await exportDialog.getByRole("menuitem", { name: "Download PNG", exact: true }).click();
        await exportDialog
          .getByRole("alert")
          .filter({ hasText: "Fixture renderer unavailable" })
          .waitFor();
        assert.equal(
          await exportDialog
            .getByRole("menuitem", { name: "Download JSON", exact: true })
            .isEnabled(),
          true,
        );
        assert.equal(exports.length, 1, "failed exports must not retry automatically");
        failExports = false;
        const pngDownloadPromise = page.waitForEvent("download");
        await exportDialog
          .getByRole("menuitem", { name: "Download PNG (high resolution)", exact: true })
          .click();
        const pngDownload = await pngDownloadPromise;
        assert.equal(pngDownload.suggestedFilename(), "whiteboard-high.png");
        assert.equal((await readFile(await pngDownload.path())).subarray(1, 4).toString(), "PNG");
        assert.equal(exports[1].quality, "high");
        assert.equal(
          exports[1].scene.elements.find((e) => e.id === "service").props.title,
          "Unsynced local title",
        );
        assert.equal(saves.length, beforeExports, "export must not save or overwrite a draft");
        assert.equal(prompts.length, 1, "export must not send prompts");
        await exportDialog.waitFor({ state: "detached" });
        await downloadButton.click();
        await page.keyboard.press("Escape");
        await exportDialog.waitFor({ state: "detached" });
        assert(await downloadButton.evaluate((el) => el === document.activeElement));
        await downloadButton.click();
        await page.mouse.click(4, viewport.height / 2);
        await exportDialog.waitFor({ state: "detached" });
        assert.equal(
          await whiteboard.isVisible(),
          true,
          "Dismissing the download menu must not close the board",
        );
        assert.deepEqual(errors, []);
        await context.close();
      }
    } finally {
      await browser.close();
    }
  }
  console.log(
    "PASS: isolated Chromium/WebKit flow boards, independent JSON/PNG downloads of unsynced drafts, export failures, save-before-prompt, remote additions and paused recovery without write replay.",
  );
} finally {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
