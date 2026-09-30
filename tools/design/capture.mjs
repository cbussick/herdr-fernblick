// Run with PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node tools/design/capture.mjs before|after URL
// All API traffic is intercepted. This never connects to or controls real agents.
import fs from "node:fs/promises";
import path from "node:path";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const phase = process.argv[2] || "before";
const base = process.argv[3] || "http://127.0.0.1:5195";
const out = path.resolve("design-gallery");
await fs.mkdir(`${out}/${phase}`, { recursive: true });
const workspaces = [
  { workspace_id: "w1", label: "Fernblick" },
  { workspace_id: "w2", label: "Phoget" },
  { workspace_id: "w3", label: "Job sheet" },
];
const agent = (n, label, status, w = 1) => ({
  agent: "pi",
  name: `agent-${n}`,
  pane_id: `w${w}:p${n}`,
  tab_id: `w${w}:t${n}`,
  tab_label: label,
  agent_status: status,
  workspace_id: `w${w}`,
  workspace_label: workspaces[w - 1].label,
  cwd: "/projects/fernblick",
  focused: false,
  revision: 1,
});
const agents = [
  agent(1, "Interface design", "done"),
  agent(2, "API research", "working"),
  agent(3, "Deployment", "blocked", 2),
  agent(4, "Performance audit", "idle", 2),
  agent(5, "GitHub Actions", "unknown", 3),
];
const tabs = [
  {
    label: "Development server",
    pane_id: "w1:p6",
    tab_id: "w1:t6",
    workspace_id: "w1",
    workspace_label: "Fernblick",
    revision: 1,
  },
];
const target = {
  runtime: "a0000000-0000-4000-8000-000000000001",
  epoch: "a0000000-0000-4000-8000-000000000002",
  sessionId: "design-fixture",
};
// A deliberately synthetic reference image, not a private upload.
const imagePath = `${out}/reference.png`;
if (phase === "before") {
  const b = await chromium.launch({ headless: true });
  const p = await b.newPage({ viewport: { width: 600, height: 400 } });
  await p.setContent(
    '<body style="margin:0;background:#e5f1fa;display:grid;place-content:center;height:100vh;font:24px sans-serif;color:#173d5c"><div style="border:2px solid #93bddb;padding:50px;background:white;border-radius:24px">Fernblick<br><small>Interface reference / sample attachment</small></div></body>',
  );
  await p.screenshot({ path: imagePath });
  await b.close();
}
const imageData = `data:image/png;base64,${(await fs.readFile(imagePath)).toString("base64")}`;
const messages = [
  {
    id: "m1",
    role: "user",
    text: "Make the workspace overview easier to scan on my phone. Keep the agent statuses visible.",
  },
  { id: "m2", role: "thinking", text: "Checking the overview layout and touch targets." },
  {
    id: "m3",
    role: "tool",
    toolName: "read · AgentOverview.tsx",
    text: "WorkspaceList\n  Workspace disclosure\n  Agent rows and status indicators",
  },
  {
    id: "m4",
    role: "assistant",
    text: "I’ve simplified the workspace list and kept each agent’s status beside its name.\n\nThe phone view remains focused on one task. On larger screens, the workspace list stays open alongside your conversation.\n\nThe changes are ready to review.",
  },
];
const node = (id, role, text, children = [], extra = {}) => ({
  id,
  parentId: null,
  role,
  text,
  isActivePath: true,
  timestamp: "2026-09-30T10:24:00Z",
  children,
  ...extra,
});
const tree = {
  roots: [
    node("m1", "user", messages[0].text, [
      node("m4", "assistant", "The changes are ready to review.", [
        node("b1", "user", "Try a persistent workspace sidebar.", [], {
          label: "Tablet layout",
          isActivePath: false,
        }),
      ]),
    ]),
  ],
  leafId: "m4",
};
const scenarios = [
  ["workspaces", "Workspace overview", "Overview"],
  ["expanded", "Workspace contents", "Overview"],
  ["agents", "All agents / every status", "Overview"],
  ["search", "Filtered workspaces", "Overview"],
  ["no-results", "Search with no results", "Overview"],
  ["empty", "No workspaces", "States"],
  ["create-menu", "Create menu", "Create"],
  ["new-agent", "New Pi agent", "Create"],
  ["new-workspace", "New workspace", "Create"],
  ["new-shell", "New shell tab", "Create"],
  ["form-error", "Create failure / retained form", "States"],
  ["chat", "Agent conversation", "Conversation"],
  ["working", "Agent working / Stop", "Conversation"],
  ["blocked", "Agent needs input", "Conversation"],
  ["chat-empty", "Empty conversation", "States"],
  ["chat-connecting", "Connecting to Pi", "States"],
  ["chat-unavailable", "Chat unavailable", "States"],
  ["chat-reconnecting", "Reconnecting with conversation history", "States"],
  ["chat-status", "Conversation status notice", "States"],
  ["chat-legacy", "Extension needs reload", "States"],
  ["chat-truncated", "Bounded transcript notice", "States"],
  ["tool-open", "Expanded tool output", "Conversation"],
  ["image", "Conversation attachment", "Conversation"],
  ["image-preview", "Attachment lightbox", "Conversation"],
  ["draft-image", "Composer with image", "Conversation"],
  ["send-pending", "Sending message", "States"],
  ["send-waiting", "Waiting for message receipt", "States"],
  ["send-error", "Send failure / retained draft", "States"],
  ["terminal", "Agent terminal", "Terminal"],
  ["terminal-error", "Terminal read failure", "States"],
  ["terminal-empty", "Empty agent terminal", "States"],
  ["terminal-loading", "Reading agent terminal", "States"],
  ["shell", "Shell terminal", "Terminal"],
  ["shell-empty", "Empty shell terminal", "States"],
  ["shell-loading", "Reading shell terminal", "States"],
  ["shell-error", "Shell unavailable", "States"],
  ["edit-agent", "Edit agent settings", "Manage"],
  ["restart", "Restart confirmation", "Manage"],
  ["close-agent", "Close agent confirmation", "Manage"],
  ["edit-shell", "Edit shell settings", "Manage"],
  ["context-menu", "Row context menu", "Manage"],
  ["context-edit", "Edit from overview", "Manage"],
  ["context-close", "Close from overview", "Manage"],
  ["paths", "Conversation paths", "Paths"],
  ["paths-prompts", "Paths / prompt filter", "Paths"],
  ["paths-labels", "Paths / labels filter", "Paths"],
  ["paths-empty", "Paths / no matches", "Paths"],
  ["paths-error", "Paths / load failure", "States"],
  ["paths-loading", "Reading conversation paths", "States"],
  ["paths-branch", "Edit and branch selection", "Paths"],
  ["loading", "Loading overview", "States"],
  ["offline", "Herdr unavailable", "States"],
];
const sizes = [
  { id: "phone", label: "Phone", width: 390, height: 844 },
  { id: "ipad", label: "iPad", width: 834, height: 1194 },
  { id: "desktop", label: "Desktop", width: 1440, height: 1000 },
];
const browser = await chromium.launch({ headless: true });
const manifest = [];
for (const size of sizes)
  for (const [id, title, group] of scenarios) {
    const page = await browser.newPage({
      viewport: { width: size.width, height: size.height },
      deviceScaleFactor: 1,
      reducedMotion: "reduce",
      locale: "en-GB",
      timezoneId: "UTC",
    });
    const snapshot = {
      type: "snapshot",
      version: id === "chat-legacy" ? 1 : 2,
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
      busy: id === "working",
      sendPending: id === "send-pending",
      truncated: id === "chat-truncated",
      messages: id === "chat-empty" ? [] : [...messages],
      status: {
        cwd: "/projects/fernblick",
        model: "GPT-6.1",
        provider: "OpenAI",
        totalTokens: 12480,
        cost: 0.18,
      },
    };
    if (["image", "image-preview"].includes(id))
      snapshot.messages = [
        {
          id: "img1",
          role: "user",
          text: "Use this as a reference for the blue palette.",
          attachments: [imageData],
        },
        {
          id: "img2",
          role: "assistant",
          text: "I’ll use the pale-blue canvas with darker text and white conversation surfaces.",
        },
      ];
    if (id === "chat-status")
      snapshot.messages.push({
        id: "status",
        role: "status",
        text: "Conversation restored. Continue from this point.",
      });
    await page.addInitScript(
      ({ snapshot, id }) => {
        class FixtureEvents {
          constructor() {
            this.timer = setTimeout(() => {
              if (id !== "chat-connecting")
                this.onmessage?.({
                  data: JSON.stringify(
                    id === "chat-unavailable"
                      ? {
                          type: "unavailable",
                          reason:
                            "Pi is not connected. Open Pi with the live-chat extension to use Chat.",
                        }
                      : snapshot,
                  ),
                });
              if (id === "chat-reconnecting") this.onerror?.();
            }, 50);
          }
          close() {
            clearTimeout(this.timer);
          }
        }
        window.EventSource = FixtureEvents;
      },
      { snapshot, id },
    );
    await page.route(
      (url) => url.pathname.startsWith("/api/"),
      async (route) => {
        const url = route.request().url();
        if (id === "loading" && url.endsWith("/api/agents")) return; // pending until page teardown
        if (id === "offline" && url.endsWith("/api/agents"))
          return route.fulfill({
            status: 503,
            json: { error: "The Herdr socket is unavailable. Check that your session is running." },
          });
        if (url.endsWith("/api/agents") && route.request().method() === "GET")
          return route.fulfill({
            json:
              id === "empty"
                ? { agents: [], tabs: [], workspaces: [] }
                : { agents, tabs, workspaces },
          });
        if (url.endsWith("/tree") && id === "paths-loading") return;
        if (url.endsWith("/prompt") && id === "send-waiting")
          return route.fulfill({ json: { type: "ack", id: target.runtime, outcome: "invoked" } });
        if (url.endsWith("/tree"))
          return route.fulfill(
            id === "paths-error"
              ? {
                  status: 503,
                  json: { error: "Pi disconnected. Try again when the agent reconnects." },
                }
              : { json: { type: "tree", id: target.runtime, target, tree } },
          );
        if (url.includes("/output?") && ["terminal-loading", "shell-loading"].includes(id)) return;
        if (url.includes("/output?"))
          return route.fulfill(
            ["terminal-error", "shell-error"].includes(id)
              ? {
                  status: 503,
                  json: { error: "Terminal output unavailable. Check the Herdr connection." },
                }
              : {
                  json: {
                    format: "text",
                    pane_id: "w1:p1",
                    tab_id: "w1:t1",
                    workspace_id: "w1",
                    revision: 1,
                    source: "fixture",
                    truncated: false,
                    text: ["terminal-empty", "shell-empty"].includes(id)
                      ? ""
                      : "~/projects/fernblick $ npm run check\n\n> fernblick@0.1.0 check\n> format · lint · typecheck · test · build\n\n✓ Formatting\n✓ No lint errors\n✓ TypeScript\n\n Test Files  16 passed (16)\n      Tests  92 passed (92)\n\n✓ built in 1.42s\n\nAll checks passed.\n\n~/projects/fernblick $",
                  },
                },
          );
        if (url.includes("/uploads/")) return route.fulfill({ path: imagePath });
        return route.fulfill({
          status: 503,
          json: {
            error:
              id === "form-error"
                ? "Could not create the workspace. Check the directory and try again."
                : "Pi disconnected before receipt.",
          },
        });
      },
    );
    try {
      await page.goto(base);
      if (!["loading", "offline"].includes(id)) await page.locator(".overview-header").waitFor();
      if (
        [
          "expanded",
          "search",
          "context-menu",
          "context-edit",
          "context-close",
          "shell",
          "shell-empty",
          "shell-loading",
          "shell-error",
          "edit-shell",
        ].includes(id)
      )
        await page.locator(".workspace-disclosure summary").first().click();
      if (id === "agents") await page.getByRole("tab", { name: "Agents", exact: true }).click();
      if (["search", "no-results"].includes(id))
        await page
          .getByRole("searchbox")
          .fill(id === "search" ? "Interface" : "No matching project");
      if (["create-menu", "new-agent", "new-workspace", "new-shell", "form-error"].includes(id)) {
        await page.getByRole("button", { name: "Open create menu" }).click();
        if (id !== "create-menu")
          await page
            .getByRole("button", {
              name:
                id === "new-agent"
                  ? /New Agent/
                  : id === "new-shell"
                    ? /New Shell Tab/
                    : /New Workspace/,
            })
            .click();
        if (id === "form-error") {
          await page.locator("dialog[open] input").nth(0).fill("Design sandbox");
          await page.locator("dialog[open] input").nth(1).fill("/projects/design");
          await page.locator("dialog[open] button[type=submit]").click();
        }
      }
      if (["context-menu", "context-edit", "context-close"].includes(id)) {
        await page.locator(".pane-row").first().click({ button: "right" });
        if (id !== "context-menu")
          await page
            .getByRole("menuitem", { name: id === "context-edit" ? "Edit agent" : "Close tab" })
            .click();
      }
      const detail = ![
        "workspaces",
        "expanded",
        "agents",
        "search",
        "no-results",
        "empty",
        "create-menu",
        "new-agent",
        "new-workspace",
        "new-shell",
        "form-error",
        "context-menu",
        "context-edit",
        "context-close",
        "loading",
        "offline",
      ].includes(id);
      if (detail) {
        if (id.startsWith("shell") || id === "edit-shell")
          await page.getByRole("button", { name: /Development server Shell terminal/ }).click();
        else {
          await page.getByRole("tab", { name: "Agents", exact: true }).click();
          await page
            .getByRole("button", {
              name:
                id === "blocked"
                  ? /Deployment/
                  : id === "working"
                    ? /API research/
                    : /Interface design/,
            })
            .first()
            .click();
        }
        await page.locator(".console").waitFor();
        if (
          !id.startsWith("shell") &&
          !["edit-shell", "chat-connecting", "chat-unavailable"].includes(id)
        )
          await page.locator(".chat-transcript").waitFor();
        if (id.startsWith("terminal")) {
          const toggle = page.getByRole("button", { name: "Switch to Terminal view" });
          if (phase === "before") await toggle.dispatchEvent("click");
          else await toggle.click();
        }
        if (id === "tool-open") await page.locator(".chat-tool summary").click();
        if (id === "image-preview")
          await page.getByRole("button", { name: "Open attached image" }).click();
        if (id === "draft-image") {
          await page.locator("input[type=file]").setInputFiles(imagePath);
          await page.locator("#agent-prompt").fill("Here is the visual direction I have in mind.");
        }
        if (["send-error", "send-waiting"].includes(id)) {
          await page.locator("#agent-prompt").fill("Please apply the blue design.");
          await page.getByRole("button", { name: "Send message" }).click();
        }
        if (["edit-agent", "edit-shell", "restart", "close-agent"].includes(id)) {
          if (phase === "before") await page.locator(".edit-tab-button").dispatchEvent("click");
          else await page.locator(".edit-tab-button").click();
          if (id === "restart")
            await page.getByRole("button", { name: "Restart agent session", exact: true }).click();
          if (id === "close-agent")
            await page.getByRole("button", { name: "Close this tab" }).click();
        }
        if (id.startsWith("paths")) {
          await page.getByRole("button", { name: "Open conversation paths" }).click();
          if (id === "paths-prompts")
            await page.getByRole("button", { name: "Your prompts", exact: true }).click();
          if (id === "paths-labels")
            await page.getByRole("button", { name: "Labels", exact: true }).click();
          if (id === "paths-empty")
            await page.getByPlaceholder("Search this conversation…").fill("not present");
          if (id === "paths-branch")
            await page.locator(".conversation-tree__row button").first().click();
        }
      }
      if (id === "offline") await page.locator(".page-state[role=alert]").waitFor();
      if (["terminal-error", "shell-error"].includes(id))
        await page.locator(".output-panel [role=alert]").waitFor();
      await page.waitForTimeout(220);
      if (
        phase === "after" &&
        [
          "loading",
          "offline",
          "chat-empty",
          "chat-connecting",
          "chat-unavailable",
          "chat-reconnecting",
          "chat-status",
          "chat-legacy",
          "chat-truncated",
          "send-pending",
          "send-waiting",
          "send-error",
          "terminal-empty",
          "terminal-loading",
          "terminal-error",
          "shell-empty",
          "shell-loading",
          "shell-error",
          "paths-loading",
          "paths-error",
        ].includes(id)
      )
        await page.locator("[data-state-kind] svg").first().waitFor();
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: `${out}/${phase}/${size.id}-${id}.png` });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
      if (overflow) console.warn(`Overflow: ${size.id}/${id}`);
      manifest.push({
        id,
        title,
        group,
        viewport: size.id,
        width: size.width,
        height: size.height,
      });
      console.log(`${phase}: ${size.id}/${id}`);
    } catch (error) {
      console.error(`FAILED ${size.id}/${id}: ${error}`);
      await page.screenshot({ path: `${out}/failure.png` });
      process.exitCode = 1;
      break;
    } finally {
      await page.close();
    }
  }
await browser.close();
await fs.writeFile(`${out}/${phase}.json`, JSON.stringify(manifest, null, 2));
await fs.copyFile("tools/design/gallery.html", `${out}/index.html`);
console.log(`Captured ${manifest.length} screens for ${phase}.`);
