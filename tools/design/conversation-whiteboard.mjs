// Synthetic browser regression: intercept every agent API; never control live agents.
// npm run build && node tools/design/conversation-whiteboard.mjs
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { createHttpServer } from "../../dist-server/server/http/server.js";
const { chromium, webkit } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const target = {
  runtime: "a0000000-0000-4000-8000-000000000001",
  epoch: "a0000000-0000-4000-8000-000000000002",
  sessionId: "board-fixture",
};
const agent = {
  agent: "pi",
  name: "Planner",
  pane_id: "w1:p1",
  tab_id: "w1:t1",
  tab_label: "Orchestrator",
  workspace_id: "w1",
  workspace_label: "FeBO",
  agent_status: "idle",
  revision: 1,
  focused: false,
  agent_session: { agent: "pi", kind: "path", source: "fixture", value: "/fixture.jsonl" },
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
    sessionFile: "/fixture.jsonl",
  },
  epoch: target.epoch,
  seq: 1,
  busy: false,
  sendPending: false,
  truncated: false,
  capabilities: { boards: true },
  messages: [
    { id: "u", role: "user", text: "Show the agent hierarchy." },
    {
      id: "a",
      role: "assistant",
      text: "Each tab groups its agents. Planner and Backend have distinct names.",
    },
  ],
  status: { cwd: "/fixture", totalTokens: 0, cost: 0 },
};
const board = {
  id: "a".repeat(64),
  revision: 1,
  updatedAt: 1,
  lastAuthor: "human",
  snapshots: [],
  access: null,
  scene: {
    engine: "react-flow",
    background: "#ffffff",
    files: {},
    elements: [
      {
        id: "box",
        type: "component",
        kind: "card",
        version: 1,
        parentId: null,
        x: 0,
        y: 0,
        width: 300,
        height: 330,
        props: {
          title: "FeBO-monorepo",
          subtitle: "Orchestrator",
          body: "Tab · 2 agents\nPlanner\nBackend",
          color: "#E7F2FA",
          icon: "",
          imageId: null,
          fields: [],
          columns: ["Column"],
          rows: [],
        },
      },
    ],
  },
};
const server = createHttpServer(
  { getDashboard: async () => ({ agents: [], tabs: [], workspaces: [] }) },
  resolve("dist"),
  {},
);
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const origin = `http://127.0.0.1:${server.address().port}`;
await mkdir(".runtime/her-21-evidence", { recursive: true });
try {
  for (const [name, engine] of [
    ["chromium", chromium],
    ["webkit", webkit],
  ]) {
    if (process.env.WHITEBOARD_BROWSER && process.env.WHITEBOARD_BROWSER !== name) continue;
    const browser = await engine.launch({ headless: true });
    try {
      for (const [layout, viewport] of [
        ["mobile", { width: 390, height: 844 }],
        ["portrait", { width: 820, height: 1180 }],
        ["desktop", { width: 1440, height: 900 }],
      ]) {
        if (process.env.WHITEBOARD_LAYOUT && process.env.WHITEBOARD_LAYOUT !== layout) continue;
        const page = await browser.newPage({
          viewport,
          serviceWorkers: "block",
          hasTouch: layout !== "desktop",
        });
        const errors = [],
          requests = [];
        page.on("pageerror", (error) => errors.push(error.message));
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
            window.fixtureWorking = () =>
              window.fixtureSources
                .filter((source) => !source.url.includes("/board/"))
                .forEach((source) =>
                  source.onmessage?.({ data: JSON.stringify({ ...snapshot, busy: true, seq: 2 }) }),
                );
          },
          { snapshot },
        );
        await page.route("**/*", (route) => {
          const url = new URL(route.request().url());
          if (url.origin !== origin) return route.abort();
          if (!url.pathname.startsWith("/api/")) return route.continue();
          if (url.pathname === "/api/agents")
            return route.fulfill({
              json: {
                agents: [agent],
                tabs: [],
                workspaces: [{ workspace_id: "w1", label: "FeBO" }],
              },
            });
          if (url.pathname.endsWith("/board")) return route.fulfill({ json: board });
          if (url.pathname.endsWith("/prompt")) {
            const body = route.request().postDataJSON();
            requests.push({ path: url.pathname, body });
            return route.fulfill({ json: { type: "ack", id: body.requestId, outcome: "invoked" } });
          }
          return route.fulfill({ status: 403, json: { error: "Unexpected fixture request" } });
        });
        await page.goto(origin + "/?pane=w1%3Ap1&session=board-fixture&whiteboard=1");
        const dialog = page.getByTestId("whiteboard");
        await dialog.waitFor();
        await dialog.getByTestId("flow-board-editor").waitFor();
        await dialog.getByRole("button", { name: "Fit drawing", exact: true }).click();
        assert.equal(await dialog.getByRole("button", { name: "Export", exact: true }).count(), 0);
        await dialog.getByRole("button", { name: "Download", exact: true }).click();
        const downloads = page.getByRole("menu", { name: "Download board", exact: true });
        await downloads.waitFor();
        assert.equal(
          await downloads.getByRole("menuitem", { name: "Download PNG", exact: true }).count(),
          1,
        );
        await page.waitForFunction(
          () => document.activeElement?.getAttribute("role") === "menuitem",
        );
        await page.keyboard.press("Escape");
        await downloads.waitFor({ state: "detached" });
        assert.match(await dialog.locator("header").first().innerText(), /Planner.*FeBO/s);
        assert.equal(await dialog.getByRole("button", { name: "Share drawing" }).count(), 0);
        assert.equal(
          await dialog.getByText(/Prompts send the drawing|Agent can edit this board/).count(),
          0,
        );
        const input = dialog.getByRole("textbox", { name: "Message the agent" });
        await input.fill("Keep this draft");
        const dock = dialog.getByTestId("whiteboard-conversation");
        const splitter = dialog.getByTestId("whiteboard-conversation-resize");
        const isDesktop = layout === "desktop";
        await splitter.waitFor();
        assert.equal(
          await splitter.getAttribute("aria-orientation"),
          isDesktop ? "vertical" : "horizontal",
        );
        const workspaceBox = await dialog.getByTestId("whiteboard-workspace").boundingBox();
        const headerBox = await dialog.locator("header").first().boundingBox();
        assert.ok(Math.abs(headerBox.width - viewport.width) < 2, "one shared full-width header");
        const minimum = Number(await splitter.getAttribute("aria-valuemin"));
        assert.equal(
          Number(await splitter.getAttribute("aria-valuenow")),
          minimum,
          "default is the lower bound",
        );
        const startDock = await dock.boundingBox();
        const startHandle = await splitter.boundingBox();
        const toggleBox = await dock
          .getByRole("button", { name: "Expand conversation" })
          .boundingBox();
        if (isDesktop) {
          assert.ok(
            Math.abs(startDock.y - workspaceBox.y) < 2,
            "sidebar starts below shared header",
          );
          assert.ok(
            startHandle.y >= headerBox.y + headerBox.height - 1,
            "divider never crosses header",
          );
        } else {
          assert.ok(
            Math.abs(startHandle.y + startHandle.height / 2 - toggleBox.y - toggleBox.height / 2) <
              2,
            "mobile icon and drag handle share one row",
          );
        }
        const from = {
          x: startHandle.x + startHandle.width / 2,
          y: startHandle.y + startHandle.height / 2,
        };
        const delta = isDesktop
          ? 600 - startDock.width
          : workspaceBox.height / 2 - startDock.height;
        const to = { x: from.x - (isDesktop ? delta : 0), y: from.y - (isDesktop ? 0 : delta) };
        if (name === "chromium" && !isDesktop) {
          // Real touch input exercises pointer capture and touch-action, not synthetic DOM events.
          const cdp = await page.context().newCDPSession(page);
          await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [from] });
          for (let step = 1; step <= 8; step++)
            await cdp.send("Input.dispatchTouchEvent", {
              type: "touchMove",
              touchPoints: [{ x: from.x, y: from.y + ((to.y - from.y) * step) / 8 }],
            });
          await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
          await cdp.detach();
        } else {
          await page.mouse.move(from.x, from.y);
          await page.mouse.down();
          await page.mouse.move(to.x, to.y, { steps: 8 });
          await page.mouse.up();
        }
        await page.waitForTimeout(50);
        assert.equal(Number(await splitter.getAttribute("aria-valuenow")), isDesktop ? 600 : 50);
        assert.equal(await input.inputValue(), "Keep this draft");
        assert.equal(await dialog.getByTestId("flow-board-editor").count(), 1);
        await page.screenshot({ path: `.runtime/her-21-evidence/${name}-${layout}-resized.png` });
        if (isDesktop) {
          assert.equal(
            await page.evaluate(() =>
              localStorage.getItem("fernblick:whiteboard-conversation-width"),
            ),
            "600",
          );
          // Keyboard bounds and Escape cancellation do not dismiss the board.
          await splitter.focus();
          await page.keyboard.press("Home");
          assert.equal(Number(await splitter.getAttribute("aria-valuenow")), minimum);
          await page.keyboard.press("ArrowRight");
          assert.equal(Number(await splitter.getAttribute("aria-valuenow")), minimum);
          const box = await splitter.boundingBox();
          await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
          await page.mouse.down();
          await page.mouse.move(box.x - 120, box.y + box.height / 2, { steps: 5 });
          await page.keyboard.press("Escape");
          await page.mouse.up();
          assert.equal(Number(await splitter.getAttribute("aria-valuenow")), minimum);
          await dialog.waitFor();
          await splitter.focus();
          await page.keyboard.press("End");
          const resized = await dock.boundingBox();
          assert.ok(resized.width <= viewport.width * 0.65 + 1);
          await dock.getByRole("button", { name: "Collapse conversation" }).click();
          assert.equal(
            Number(await splitter.getAttribute("aria-valuenow")),
            minimum,
            "toggle above the expanded preset returns to default",
          );
          await splitter.focus();
          for (let i = 0; i < 3; i++) await page.keyboard.press("Shift+ArrowLeft");
          assert.equal(Number(await splitter.getAttribute("aria-valuenow")), 640);
        } else {
          await splitter.focus();
          await page.keyboard.press("ArrowUp");
          assert.equal(await dock.getAttribute("data-expanded"), "true");
          await page.keyboard.press("ArrowDown");
          assert.equal(Number(await splitter.getAttribute("aria-valuenow")), 50);
        }
        await dialog.getByRole("button", { name: "Collapse conversation" }).click();
        assert.equal(
          Number(await splitter.getAttribute("aria-valuenow")),
          minimum,
          "toggle reacts to any manually enlarged size",
        );
        await dialog.getByRole("button", { name: "Expand conversation" }).click();
        await dialog.getByText("Show the agent hierarchy.", { exact: true }).waitFor();
        await dialog.getByRole("button", { name: "Collapse conversation" }).click();
        assert.equal(await input.inputValue(), "Keep this draft");
        await page.screenshot({ path: `.runtime/her-21-evidence/${name}-${layout}-board.png` });
        await dialog.getByRole("button", { name: "← Back", exact: true }).click();
        await dialog.waitFor({ state: "detached" });
        const chatInput = page.getByRole("textbox").first();
        assert.equal(await chatInput.inputValue(), "Keep this draft");
        await chatInput.fill("Move Planner above Backend on the whiteboard.");
        await page.getByRole("button", { name: "Send message", exact: true }).click();
        await page.waitForTimeout(100);
        assert.equal(requests.length, 1);
        assert.equal(requests[0].path, "/api/agents/w1%3Ap1/prompt");
        assert.equal(requests[0].body.text, "Move Planner above Backend on the whiteboard.");
        await page.getByRole("button", { name: "Open whiteboard", exact: true }).click();
        await dialog.waitFor();
        await dialog.getByTestId("flow-board-editor").waitFor();
        if (isDesktop) {
          assert.equal(
            Number(await splitter.getAttribute("aria-valuenow")),
            minimum,
            "collapsed default survives closing/reopening the board",
          );
        }
        await input.fill("Add an arrow.");
        await dialog.getByRole("button", { name: "Send", exact: true }).click();
        await page.waitForTimeout(100);
        assert.equal(requests.length, 2);
        assert.equal(requests[1].path, "/api/agents/w1%3Ap1/board/prompt");
        assert.equal(requests[1].body.uploadId, undefined);
        await page.evaluate(() => window.fixtureWorking());
        await dialog
          .getByTestId("whiteboard-activity")
          .getByText("Working", { exact: true })
          .waitFor();
        await page.screenshot({ path: `.runtime/her-21-evidence/${name}-${layout}-working.png` });
        if (layout === "mobile") {
          await page.setViewportSize({ width: 390, height: 500 });
          const box = await input.boundingBox();
          assert.ok(
            box && box.y >= 0 && box.y + box.height <= 500,
            "keyboard-sized viewport keeps composer visible",
          );
        }
        assert.deepEqual(errors, [], `${name}/${layout}: no page errors`);
        await page.close();
      }
      const stale = await browser.newPage({ serviceWorkers: "block" });
      await stale.addInitScript(
        ({ snapshot }) => {
          window.EventSource = class {
            constructor() {
              this.timer = setTimeout(
                () => this.onmessage?.({ data: JSON.stringify(snapshot) }),
                20,
              );
            }
            close() {
              clearTimeout(this.timer);
            }
          };
        },
        { snapshot },
      );
      await stale.route("**/api/**", (route) =>
        route.fulfill({
          json: { agents: [agent], tabs: [], workspaces: [{ workspace_id: "w1", label: "FeBO" }] },
        }),
      );
      await stale.goto(origin + "/?pane=w1%3Ap1&session=old-session&whiteboard=1");
      await stale
        .getByText("This whiteboard link belongs to a different Pi conversation.")
        .waitFor();
      assert.equal(await stale.getByTestId("whiteboard").count(), 0);
      await stale.close();
    } finally {
      await browser.close();
    }
  }
  console.log(
    "Conversation whiteboard passed: Chromium/WebKit, mobile/portrait/desktop, deep links, stale session rejection, draft preservation and no automatic uploads.",
  );
} finally {
  await new Promise((done) => server.close(done));
}
