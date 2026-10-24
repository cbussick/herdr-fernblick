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
const common = {
  angle: 0,
  strokeColor: "#183B50",
  backgroundColor: "transparent",
  fillStyle: "solid",
  strokeWidth: 1,
  strokeStyle: "solid",
  roughness: 0,
  opacity: 100,
  groupIds: [],
  frameId: null,
  roundness: null,
  seed: 1,
  version: 1,
  versionNonce: 1,
  isDeleted: false,
  boundElements: [],
  updated: 1,
  link: null,
  locked: false,
};
const board = {
  id: "a".repeat(64),
  revision: 1,
  updatedAt: 1,
  lastAuthor: "human",
  snapshots: [],
  access: null,
  scene: {
    background: "#ffffff",
    files: {},
    elements: [
      {
        ...common,
        id: "box",
        type: "rectangle",
        x: 0,
        y: 0,
        width: 300,
        height: 330,
        backgroundColor: "#E7F2FA",
      },
      {
        ...common,
        id: "text",
        type: "text",
        x: 20,
        y: 20,
        width: 250,
        height: 280,
        text: "FeBO-monorepo\n\nOrchestrator\nTab · 2 agents\n\nPlanner\nBackend",
        originalText: "FeBO-monorepo\n\nOrchestrator\nTab · 2 agents\n\nPlanner\nBackend",
        fontSize: 22,
        fontFamily: 5,
        textAlign: "left",
        verticalAlign: "top",
        containerId: null,
        autoResize: true,
        lineHeight: 1.25,
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
    const browser = await engine.launch({ headless: true });
    try {
      for (const [layout, viewport] of [
        ["mobile", { width: 390, height: 844 }],
        ["portrait", { width: 820, height: 1180 }],
        ["desktop", { width: 1440, height: 900 }],
      ]) {
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
        await dialog.locator("canvas").first().waitFor();
        await dialog.getByRole("button", { name: "Fit drawing", exact: true }).click();
        assert.match(await dialog.locator("header").first().innerText(), /Planner.*FeBO/s);
        assert.equal(await dialog.getByRole("button", { name: "Share drawing" }).count(), 0);
        assert.equal(
          await dialog.getByText(/Prompts send the drawing|Agent can edit this board/).count(),
          0,
        );
        const input = dialog.getByRole("textbox", { name: "Message the agent" });
        await input.fill("Keep this draft");
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
        await dialog.locator("canvas").first().waitFor();
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
