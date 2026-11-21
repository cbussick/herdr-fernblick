import { report } from "../report.mjs";
// Session-navigation acceptance tests: assert the fixed URL/view/draft invariants.
// npm run build && node tools/design/session-navigation-audit.mjs
// All API/SSE traffic is synthetic. No live Herdr/Pi sessions are contacted.
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { createHttpServer } from "../../dist-server/server/http/server.js";
import { chromium, webkit } from "playwright";

const makeAgent = (id) => ({
  agent: "pi",
  name: `Agent ${id}`,
  pane_id: `w1:p${id}`,
  tab_id: `w1:t${id}`,
  workspace_id: "w1",
  agent_status: "idle",
  revision: 1,
  focused: false,
  pi_session_id: `s${id}`,
  agent_session: { agent: "pi", kind: "path", source: "fixture", value: `/fixture-${id}.jsonl` },
});
const a = makeAgent(1),
  b = makeAgent(2);
const fresh = { ...b, pi_session_id: undefined, agent_session: undefined };
const snapshots = Object.fromEntries(
  [a, b, makeAgent(3)].map((agent, index) => [
    agent.pane_id,
    {
      type: "snapshot",
      version: 2,
      identity: {
        runtime: `a0000000-0000-4000-8000-00000000000${index + 1}`,
        epoch: `b0000000-0000-4000-8000-00000000000${index + 1}`,
        sessionId: agent.pi_session_id,
        pid: index + 1,
        processStart: "1",
        pane: agent.pane_id,
        herdrSocket: "/fixture.sock",
        sessionFile: `/fixture-${index + 1}.jsonl`,
      },
      epoch: `b0000000-0000-4000-8000-00000000000${index + 1}`,
      seq: 1,
      busy: false,
      sendPending: false,
      truncated: false,
      capabilities: { boards: true },
      messages: [{ id: "message", role: "user", text: `Conversation ${index + 1}` }],
      status: { cwd: "/fixture", totalTokens: 0, cost: 0 },
    },
  ]),
);
const board = {
  id: "a".repeat(64),
  revision: 1,
  updatedAt: 1,
  lastAuthor: "human",
  snapshots: [],
  access: null,
  scene: { engine: "react-flow", background: "#ffffff", files: {}, elements: [] },
};
const server = createHttpServer(
  { getDashboard: async () => ({ agents: [], tabs: [], workspaces: [] }) },
  resolve("dist"),
  {},
);
await new Promise((done) => {
  server.listen(0, "127.0.0.1", done);
});
const origin = `http://127.0.0.1:${server.address().port}`;

async function fixture(browser, { savedB = false, emit = true, width = 1440 } = {}) {
  const page = await browser.newPage({
    viewport: { width, height: 1000 },
    serviceWorkers: "block",
  });
  page.setDefaultTimeout(10_000);
  const closeStarted = Promise.withResolvers();
  const createStarted = Promise.withResolvers();
  const state = {
    savedB,
    activeA: true,
    errors: [],
    boardTargets: [],
    createdAgent: null,
    tabs: [],
    closeStarted: closeStarted.promise,
    createStarted: createStarted.promise,
    finishClose: null,
    finishCreate: null,
  };
  page.on("pageerror", (error) => state.errors.push(error.message));
  await page.addInitScript(
    ({ snapshots, emit }) => {
      window.fixtureSources = [];
      window.EventSource = class {
        constructor(url) {
          this.url = String(url);
          window.fixtureSources.push(this);
          const match = this.url.match(/^\/api\/agents\/([^/]+)\/chat$/);
          if (match && emit) {
            this.timer = setTimeout(
              () =>
                this.onmessage?.({ data: JSON.stringify(snapshots[decodeURIComponent(match[1])]) }),
              20,
            );
          }
        }
        close() {
          clearTimeout(this.timer);
          window.fixtureSources = window.fixtureSources.filter((source) => source !== this);
        }
      };
    },
    { snapshots, emit },
  );
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) {
      return route.abort();
    }
    if (!url.pathname.startsWith("/api/")) {
      return route.continue();
    }
    if (url.pathname.startsWith("/api/tabs/") && route.request().method() === "DELETE") {
      const pending = Promise.withResolvers();
      state.finishClose = pending.resolve;
      closeStarted.resolve();
      await pending.promise;
      state.activeA = false;
      return route.fulfill({ json: { ok: true } });
    }
    if (url.pathname === "/api/agents" && route.request().method() === "POST") {
      const pending = Promise.withResolvers();
      state.finishCreate = pending.resolve;
      createStarted.resolve();
      await pending.promise;
      state.createdAgent = makeAgent(3);
      return route.fulfill({ json: { agent: state.createdAgent } });
    }
    if (url.pathname === "/api/tabs" && route.request().method() === "POST") {
      const tab = {
        label: "Fixture shell",
        pane_id: "w1:p4",
        tab_id: "w1:t4",
        workspace_id: "w1",
        revision: 1,
      };
      state.tabs.push(tab);
      return route.fulfill({ json: { tab } });
    }
    const agents = [
      ...(state.activeA ? [a] : []),
      state.savedB ? b : fresh,
      ...(state.createdAgent ? [state.createdAgent] : []),
    ];
    if (url.pathname === "/api/agents") {
      return route.fulfill({
        json: { agents, tabs: state.tabs, workspaces: [{ workspace_id: "w1", label: "Fixture" }] },
      });
    }
    if (url.pathname.startsWith("/api/sessions/")) {
      const id = url.pathname.split("/").at(-1);
      return route.fulfill({
        json: {
          agent: agents.find((agent) => agent.pi_session_id === id) ?? null,
          chat:
            id === "s1"
              ? {
                  id: "a".repeat(64),
                  sessionId: "s1",
                  title: "Saved A",
                  cwd: "/fixture",
                  preview: "",
                  updatedAt: "2026-01-01T12:00:00.000Z",
                  activePaneId: state.activeA ? a.pane_id : null,
                }
              : null,
        },
      });
    }
    if (url.pathname.endsWith("/board")) {
      state.boardTargets.push(route.request().postDataJSON().target.sessionId);
      return route.fulfill({ json: board });
    }
    if (url.pathname.endsWith("/output")) {
      return route.fulfill({
        json: {
          format: "text",
          pane_id: a.pane_id,
          revision: 1,
          source: "visible",
          tab_id: a.tab_id,
          text: "Fixture terminal",
          truncated: false,
          workspace_id: "w1",
        },
      });
    }
    state.errors.push(`Unexpected fixture API: ${route.request().method()} ${url.pathname}`);
    return route.fulfill({ status: 500, json: { error: "Unexpected fixture API" } });
  });
  async function openAgent(index) {
    await page.getByRole("tab", { name: "Agents", exact: true }).click();
    await page.getByTestId("pane-row").nth(index).click();
  }
  const path = () => new URL(page.url()).pathname;
  return { page, state, openAgent, path };
}

try {
  for (const [name, engine] of Object.entries({ chromium, webkit })) {
    const browser = await engine.launch({ headless: true });
    try {
      {
        const { page, state, openAgent, path } = await fixture(browser);
        await page.goto(origin + "/sessions/s1/chat");
        await page
          .getByTestId("output-panel")
          .getByText("Conversation 1", { exact: true })
          .waitFor();
        await openAgent(1);
        await page
          .getByTestId("output-panel")
          .getByText("Conversation 2", { exact: true })
          .waitFor();
        assert.equal(path(), "/panes/w1%3Ap2/chat");
        await page.reload();
        await page
          .getByTestId("output-panel")
          .getByText("Conversation 2", { exact: true })
          .waitFor();
        await openAgent(0);
        assert.equal(path(), "/sessions/s1/chat");
        await page
          .getByTestId("output-panel")
          .getByText("Conversation 1", { exact: true })
          .waitFor();
        await page.reload();
        await page
          .getByTestId("output-panel")
          .getByText("Conversation 1", { exact: true })
          .waitFor();
        assert.deepEqual(state.errors, []);
        report(`${name}: PASS fresh-agent URL/reload and switching back to saved agent`);
        await page.close();
      }
      {
        const { page, state, openAgent, path } = await fixture(browser);
        await page.goto(origin + "/sessions/s1/chat");
        await page.getByRole("button", { name: "Open whiteboard", exact: true }).waitFor();
        await openAgent(1);
        await page
          .getByTestId("output-panel")
          .getByText("Conversation 2", { exact: true })
          .waitFor();
        await page.getByRole("button", { name: "Open whiteboard", exact: true }).click();
        const drawing = page.getByTestId("whiteboard");
        await drawing.waitFor();
        assert.equal(path(), "/panes/w1%3Ap2/whiteboard");
        await page.reload();
        await drawing.waitFor();
        assert.equal(path(), "/panes/w1%3Ap2/whiteboard");
        state.savedB = true;
        await page.waitForURL((url) => url.pathname === "/sessions/s2/whiteboard");
        // Promotion reconnects SSE when persisted metadata arrives; wait for that
        // short fixture reconnect before testing the stable board-close behavior.
        await page.waitForTimeout(250);
        await drawing.waitFor();
        await drawing.getByRole("button", { name: "← Back", exact: true }).click();
        await page.waitForURL((url) => url.pathname === "/sessions/s2/chat");
        assert.equal(path(), "/sessions/s2/chat");
        assert.equal(await drawing.count(), 0);
        assert.deepEqual(state.errors, []);
        report(`${name}: PASS closing board after fresh-session promotion`);
        await page.close();
      }
      {
        const { page, state, path } = await fixture(browser);
        await page.goto(origin + "/panes/w1%3Ap2/chat");
        await page
          .getByTestId("output-panel")
          .getByText("Conversation 2", { exact: true })
          .waitFor();
        // Survive a dashboard poll without promoting the in-memory ID.
        await page.waitForTimeout(2100);
        assert.equal(path(), "/panes/w1%3Ap2/chat");
        assert.deepEqual(state.errors, []);
        report(`${name}: PASS unsaved direct-pane link stays live and resolvable`);
        await page.close();
      }
      {
        const { page, state, path } = await fixture(browser);
        await page.goto(origin + "/sessions/s1/whiteboard");
        const drawing = page.getByTestId("whiteboard");
        await drawing.waitFor();
        const entries = await page.evaluate(() => history.length);
        await drawing.getByRole("button", { name: "← Back", exact: true }).click();
        await page.waitForURL((url) => url.pathname === "/sessions/s1/chat");
        assert.equal(await page.evaluate(() => history.length), entries);
        assert.equal(path(), "/sessions/s1/chat");
        assert.equal(await drawing.count(), 0);
        assert.deepEqual(state.errors, []);
        report(`${name}: PASS direct board close replaces history without a reopen cycle`);
        await page.close();
      }
      {
        const { page, state, path } = await fixture(browser);
        await page.goto(origin + "/sessions/s1/chat");
        const composer = page.getByPlaceholder("Message…", { exact: true });
        await composer.fill("Keep through restart");
        await page.locator('input[type="file"]').setInputFiles({
          name: "draft.png",
          mimeType: "image/png",
          buffer: Buffer.from(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR5kAAAAASUVORK5CYII=",
            "base64",
          ),
        });
        state.activeA = false;
        await page
          .getByRole("heading", { name: "This conversation is inactive", exact: true })
          .waitFor();
        state.activeA = true;
        await composer.waitFor();
        assert.equal(await composer.inputValue(), "Keep through restart");
        assert.equal(
          await page.getByRole("button", { name: "Preview image 1", exact: true }).count(),
          1,
        );
        assert.equal(path(), "/sessions/s1/chat");
        assert.deepEqual(state.errors, []);
        report(`${name}: PASS text and attachments survive an inactive restart poll`);
        await page.close();
      }
      {
        const { page, state, openAgent, path } = await fixture(browser);
        await page.goto(origin + "/sessions/s1/chat");
        await openAgent(1);
        await page
          .getByTestId("output-panel")
          .getByText("Conversation 2", { exact: true })
          .waitFor();
        await page.getByRole("button", { name: "Open whiteboard", exact: true }).click();
        await page.getByTestId("whiteboard").waitFor();
        const replacement = {
          ...snapshots[b.pane_id],
          epoch: "c0000000-0000-4000-8000-000000000001",
          identity: { ...snapshots[b.pane_id].identity, sessionId: "s3" },
        };
        await page.evaluate(
          ({ replacement, pane }) => {
            for (const source of window.fixtureSources) {
              if (source.url === `/api/agents/${encodeURIComponent(pane)}/chat`) {
                source.onmessage?.({ data: JSON.stringify(replacement) });
              }
            }
          },
          { replacement, pane: b.pane_id },
        );
        await page
          .getByText("This pane is now running a different conversation.", { exact: true })
          .waitFor();
        assert(!state.boardTargets.includes("s3"));
        assert.equal(await page.getByTestId("whiteboard").count(), 0);
        assert.equal(path(), "/panes/w1%3Ap2/whiteboard");
        assert.deepEqual(state.errors, []);
        report(`${name}: PASS replacement cannot inherit the pending conversation's board`);
        await page.close();
      }
      {
        const { page, state, openAgent, path } = await fixture(browser, { savedB: true });
        await page.goto(origin + "/sessions/s1/chat");
        await page.getByRole("button", { name: "Edit w1:t1", exact: true }).click();
        const dialog = page.locator("dialog[open]");
        await dialog.getByRole("button", { name: "Close this tab", exact: true }).click();
        await dialog.getByRole("button", { name: "Close tab", exact: true }).click();
        await state.closeStarted;
        await dialog.getByRole("button", { name: "Back", exact: true }).click();
        await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
        await openAgent(1);
        await page.waitForURL((url) => url.pathname === "/sessions/s2/chat");
        const closed = page.waitForResponse((response) => response.request().method() === "DELETE");
        state.finishClose();
        await closed;
        await page.waitForTimeout(150);
        assert.equal(path(), "/sessions/s2/chat");
        assert.deepEqual(state.errors, []);
        report(`${name}: PASS late tab-close cannot dismiss the newly selected session`);
        await page.close();
      }
      {
        const { page, state, openAgent, path } = await fixture(browser, { savedB: true });
        await page.goto(origin);
        await page.getByRole("button", { name: "Open create menu", exact: true }).click();
        await page.getByRole("button", { name: /^New Agent/ }).click();
        const dialog = page.locator("dialog[open]");
        await dialog.getByRole("button", { name: "Create agent", exact: true }).click();
        await state.createStarted;
        await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
        await openAgent(0);
        await page.waitForURL((url) => url.pathname === "/sessions/s1/chat");
        const created = page.waitForResponse(
          (response) =>
            response.url().endsWith("/api/agents") && response.request().method() === "POST",
        );
        state.finishCreate();
        await created;
        await page.waitForTimeout(150);
        assert.equal(path(), "/sessions/s1/chat");
        assert.equal(await page.getByTestId("pane-row").count(), 3);
        assert.deepEqual(state.errors, []);
        report(`${name}: PASS dismissed creation updates dashboard without stealing navigation`);
        await page.close();
      }
      {
        const { page, state, path } = await fixture(browser);
        await page.goto(origin);
        await page.getByRole("button", { name: "Open create menu", exact: true }).click();
        await page.getByRole("button", { name: /^New Shell Tab/ }).click();
        await page
          .locator("dialog[open]")
          .getByRole("button", { name: "Create tab", exact: true })
          .click();
        await page.waitForURL((url) => url.pathname === "/panes/w1%3Ap4/terminal");
        assert.equal(path(), "/panes/w1%3Ap4/terminal");
        assert.deepEqual(state.errors, []);
        report(`${name}: PASS new shell opens at its terminal URL`);
        await page.close();
      }
      {
        const { page, state, path } = await fixture(browser, { emit: false });
        await page.goto(origin + "/sessions/s1/chat");
        await page.getByRole("button", { name: "Switch to Terminal view", exact: true }).click();
        await page.waitForURL((url) => url.pathname === "/sessions/s1/terminal");
        assert.equal(path(), "/sessions/s1/terminal");
        await page.getByText("Checking conversation…", { exact: true }).waitFor();
        assert.deepEqual(state.errors, []);
        report(`${name}: PASS early terminal switch preserves session identity and readiness gate`);
        await page.close();
      }
      for (const width of [390, 820]) {
        {
          const { page, state, openAgent, path } = await fixture(browser, { width });
          await page.goto(origin);
          await openAgent(1);
          await page
            .getByTestId("output-panel")
            .getByText("Conversation 2", { exact: true })
            .waitFor();
          assert.equal(path(), "/panes/w1%3Ap2/chat");
          await page.reload();
          await page
            .getByTestId("output-panel")
            .getByText("Conversation 2", { exact: true })
            .waitFor();
          assert.equal(path(), "/panes/w1%3Ap2/chat");
          assert.deepEqual(state.errors, []);
          report(`${name} ${width}px: PASS fresh-session reload retains the conversation`);
          await page.close();
        }
        {
          const { page, state, path } = await fixture(browser, { width, emit: false });
          await page.goto(origin + "/sessions/s1/chat");
          await page.getByRole("button", { name: "Switch to Terminal view", exact: true }).click();
          await page.waitForURL((url) => url.pathname === "/sessions/s1/terminal");
          assert.equal(path(), "/sessions/s1/terminal");
          assert.deepEqual(state.errors, []);
          report(`${name} ${width}px: PASS early mode switch keeps the pinned URL`);
          await page.close();
        }
        {
          const { page, state, path } = await fixture(browser, { width });
          await page.goto(origin + "/sessions/s1/whiteboard");
          const drawing = page.getByTestId("whiteboard");
          await drawing.waitFor();
          const entries = await page.evaluate(() => history.length);
          await drawing.getByRole("button", { name: "← Back", exact: true }).click();
          await page.waitForURL((url) => url.pathname === "/sessions/s1/chat");
          assert.equal(path(), "/sessions/s1/chat");
          assert.equal(await page.evaluate(() => history.length), entries);
          assert.deepEqual(state.errors, []);
          report(`${name} ${width}px: PASS direct board close does not add a history cycle`);
          await page.close();
        }
        {
          const { page, state } = await fixture(browser, { width });
          await page.goto(origin + "/sessions/s1/chat");
          const composer = page.getByPlaceholder("Message…", { exact: true });
          await composer.fill("Keep through restart");
          state.activeA = false;
          await page
            .getByRole("heading", { name: "This conversation is inactive", exact: true })
            .waitFor();
          state.activeA = true;
          await composer.waitFor();
          assert.equal(await composer.inputValue(), "Keep through restart");
          assert.deepEqual(state.errors, []);
          report(`${name} ${width}px: PASS restart-window draft retention`);
          await page.close();
        }
      }
    } finally {
      await browser.close();
    }
  }
} finally {
  await new Promise((done) => {
    server.close(done);
  });
}
