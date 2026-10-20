// All API/SSE traffic is synthetic. Never connects to or controls real agents.
// PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node tools/design/read-agent-status.mjs URL
import assert from "node:assert/strict";
const { chromium, webkit } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.argv[2] || "http://127.0.0.1:5203";
const identity = {
  runtime: "a0000000-0000-4000-8000-000000000001",
  epoch: "a0000000-0000-4000-8000-000000000002",
  sessionId: "read-status-fixture",
  pid: 123,
  processStart: "fixture",
  pane: "w1:p1",
  herdrSocket: "/fixtures/herdr.sock",
  sessionFile: "/fixtures/session.jsonl",
};
for (const [engine, browserType] of [
  ["chromium", chromium],
  ["webkit", webkit],
]) {
  const browser = await browserType.launch();
  try {
    for (const [width, height] of [
      [390, 844],
      [834, 1194],
      [1440, 1000],
    ]) {
      const page = await browser.newPage({ viewport: { width, height }, serviceWorkers: "block" });
      const errors = [];
      let completion = 12;
      const completionId = () => completion.toString(16).padStart(64, "0");
      const readCompletions = new Set();
      let polls = 0;
      page.on("pageerror", (error) => errors.push(error.message));
      await page.addInitScript((identity) => {
        window.EventSource = class {
          constructor() {
            this.timer = setTimeout(
              () =>
                this.onmessage?.({
                  data: JSON.stringify({
                    type: "snapshot",
                    version: 2,
                    identity,
                    epoch: identity.epoch,
                    seq: 1,
                    busy: false,
                    sendPending: false,
                    truncated: false,
                    status: { cwd: "/fixtures", totalTokens: 10, cost: 0 },
                    messages: [
                      { id: "answer", role: "assistant", text: "The work is ready to read." },
                    ],
                  }),
                }),
              10,
            );
          }
          close() {
            clearTimeout(this.timer);
          }
        };
      }, identity);
      await page.route("**/api/**", async (route) => {
        const request = route.request();
        const pathname = decodeURIComponent(new URL(request.url()).pathname);
        if (pathname === "/api/agents/w1:p1/read" && request.method() === "POST") {
          const id = request.postDataJSON().completionId;
          if (id !== completionId())
            return route.fulfill({ status: 409, json: { error: "Answer changed" } });
          readCompletions.add(id);
          return route.fulfill({ json: { ok: true } });
        }
        if (pathname !== "/api/agents" || request.method() !== "GET") {
          errors.push(`Unexpected request: ${request.method()} ${request.url()}`);
          return route.fulfill({ status: 500, json: { error: "Unexpected request" } });
        }
        polls++;
        await route.fulfill({
          json: {
            agents: [
              {
                agent: "pi",
                name: "fixture",
                agent_status: "done",
                focused: false,
                pane_id: "w1:p1",
                tab_id: "w1:t1",
                workspace_id: "w1",
                revision: polls,
                state_change_seq: completion,
                completion: { id: completionId(), read: readCompletions.has(completionId()) },
                tab_label: "Ready answer",
                agent_session: {
                  agent: "pi",
                  kind: "path",
                  source: "fixture",
                  value: identity.sessionFile,
                },
              },
            ],
            tabs: [],
            workspaces: [{ workspace_id: "w1", label: "Project" }],
          },
        });
      });
      await page.goto(base);
      const workspace = page.getByTestId("workspace-disclosure");
      await workspace.locator("summary").click();
      const row = page.getByTestId("pane-row");
      assert((await row.textContent()).includes("New answer"));
      await row.click();
      await page.getByText("The work is ready to read.", { exact: true }).waitFor();
      await page.getByRole("button", { name: "Back to overview", exact: true }).click();
      await row.getByText("Idle", { exact: true }).waitFor();
      const afterReading = polls;
      await page.waitForResponse((response) => new URL(response.url()).pathname === "/api/agents");
      assert(polls > afterReading);
      assert((await row.textContent()).includes("Idle"), "Polling must not restore the read badge");
      assert((await workspace.locator("summary").textContent()).includes("Idle"));
      await page.reload();
      await workspace.waitFor();
      if (!(await row.isVisible())) await workspace.locator("summary").click();
      await row.getByText("Idle", { exact: true }).waitFor();
      assert(
        (await workspace.locator("summary").textContent()).includes("Idle"),
        "Reload must restore backend read receipts",
      );
      completion = 14;
      await row.getByText("New answer", { exact: true }).waitFor();
      assert((await workspace.locator("summary").textContent()).includes("New answer"));
      assert.deepEqual(errors, []);
      console.log(
        `${engine} ${width}x${height}: read/back stays Idle across polling and reload; next answer unread`,
      );
      await page.close();
    }
  } finally {
    await browser.close();
  }
}
