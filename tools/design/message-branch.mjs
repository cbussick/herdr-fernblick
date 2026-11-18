// Isolated production UI fixture: no live agents, sockets, or model calls.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { createHttpServer } from "../../dist-server/server/http/server.js";
const agent = {
  agent: "pi",
  name: "Conversation paths",
  pane_id: "w1:p1",
  tab_id: "w1:t1",
  tab_label: "Conversation paths",
  workspace_id: "w1",
  workspace_label: "Fernblick",
  agent_status: "idle",
  revision: 1,
  focused: false,
  agent_session: { agent: "pi", kind: "path", source: "fixture", value: "/fixture.jsonl" },
};
const target = {
  runtime: "a0000000-0000-4000-8000-000000000001",
  epoch: "a0000000-0000-4000-8000-000000000002",
  sessionId: "branch-fixture",
};
const snapshot = {
  type: "snapshot",
  version: 2,
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
  truncated: false,
  status: { cwd: "/projects/fernblick", totalTokens: 0, cost: 0 },
  messages: [
    {
      id: "u",
      role: "user",
      text: "Add a shortcut beside Copy so I can jump back to an earlier message and try a different direction.",
      timestamp: 1777370400000,
    },
    {
      id: "a",
      role: "assistant",
      text: "I’ll reuse the conversation tree: edit and resend an earlier prompt, or continue from an agent reply. Your existing path stays available.",
      timestamp: 1777370460000,
    },
    {
      id: "u2",
      role: "user",
      text: "Keep the confirmation small, and make it clear that file changes are not undone.",
      timestamp: 1777370520000,
    },
    {
      id: "a2",
      role: "assistant",
      text: "The shortcut is ready. Choose a message above to explore another path.",
      timestamp: 1777370580000,
    },
  ],
};
const server = createHttpServer(
  { getDashboard: async () => ({ agents: [], tabs: [], workspaces: [] }) },
  resolve("dist"),
  {},
);
await new Promise((done) => server.listen(0, "127.0.0.1", done));
await mkdir("design-gallery/message-branch", { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  for (const width of [390, 1440]) {
    const page = await browser.newPage({
      viewport: { width, height: 950 },
      serviceWorkers: "block",
    });
    const errors = [],
      navigations = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript((initial) => {
      window.EventSource = class {
        constructor() {
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
              tabs: [],
              workspaces: [{ workspace_id: "w1", label: "Fernblick" }],
            },
          });
        if (path.endsWith("/tree-navigation")) {
          const body = route.request().postDataJSON();
          assert.deepEqual(body.target, target);
          navigations.push(body.entryId);
          return route.fulfill({
            status: 409,
            json: { error: "Navigation rejected. Please try again when Pi is idle." },
          });
        }
        return route.fulfill({ status: 503, json: { error: "Synthetic fixture" } });
      },
    );
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.getByRole("tab", { name: "Agents", exact: true }).click();
    await page.getByTestId("pane-row").click();
    await page.locator('[data-message-id="u"] [aria-label="Jump back here"]').waitFor();
    await page.screenshot({ path: `design-gallery/message-branch/${width}-chat.png` });
    await page.locator('[data-message-id="u"] [aria-label="Jump back here"]').click();
    const dialog = page.getByRole("dialog", { name: "Jump back to this point?" });
    await dialog.waitFor();
    assert.equal(navigations.length, 0);
    await page.screenshot({ path: `design-gallery/message-branch/${width}-confirm.png` });
    assert(
      await dialog
        .getByRole("button", { name: "Cancel" })
        .evaluate((el) => el === document.activeElement),
    );
    await dialog.getByRole("button", { name: "Cancel" }).click();
    assert.equal(navigations.length, 0);
    await page.locator('[data-message-id="a"] [aria-label="Jump back here"]').click();
    await dialog.getByRole("button", { name: "Continue from here" }).click();
    await dialog.getByRole("alert").waitFor();
    assert.deepEqual(navigations, ["a"]);
    await dialog.getByRole("button", { name: "Cancel" }).click();
    assert.deepEqual(errors, []);
    console.log(
      `${width}px: confirmation, cancellation, keyboard focus, reply navigation and errors passed`,
    );
    await page.close();
  }
} finally {
  await browser.close();
  await new Promise((done) => server.close(done));
}
