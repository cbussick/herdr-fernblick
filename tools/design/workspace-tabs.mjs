// Synthetic API fixtures only; no Herdr/Pi sockets or real agents are used.
// PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node tools/design/workspace-tabs.mjs URL
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
const { chromium, webkit } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.argv[2] || "http://127.0.0.1:5212";
const out = "design-gallery/workspace-tabs";
await mkdir(out, { recursive: true });
const workspaces = [
  { workspace_id: "w1", label: "FeBOp-monorepo" },
  { workspace_id: "w2", label: "Private" },
  { workspace_id: "w3", label: "fernblick" },
];
const agent = (pane, name, tab = "w1:t1", tabLabel = "orchestrator overhaul") => ({
  agent: "pi",
  name,
  pane_id: pane,
  tab_id: tab,
  tab_label: tabLabel,
  workspace_id: pane.split(":")[0],
  workspace_label: workspaces.find((w) => w.workspace_id === pane.split(":")[0]).label,
  agent_status: "idle",
  focused: false,
  revision: 1,
});
const shell = (pane, tab, label) => ({
  pane_id: pane,
  tab_id: tab,
  label,
  workspace_id: pane.split(":")[0],
  revision: 1,
});
for (const [engine, browserType] of Object.entries({ chromium, webkit })) {
  const browser = await browserType.launch();
  try {
    for (const [width, height] of [
      [320, 740],
      [390, 844],
      [834, 1194],
      [1194, 834],
      [1440, 1000],
    ]) {
      const page = await browser.newPage({
        viewport: { width, height },
        serviceWorkers: "block",
        reducedMotion: "reduce",
      });
      const errors = [];
      const mutations = [];
      let polls = 0;
      const agents = [
        agent("w1:p1", "planner"),
        agent("w1:p2", "backend"),
        agent("w1:p3", "test-reviewer"),
        agent("w1:p4", "integration"),
        agent("w1:p5", null, "w1:t2", "API cleanup"),
        agent("w3:p1", "designer", "w3:t1", "Navigation"),
      ];
      const tabs = [
        shell("w1:p6", "w1:t1", "orchestrator overhaul"),
        shell("w2:p1", "w2:t1", "anatomy skill"),
        shell("w2:p2", "w2:t2", "Oculus Quest 3 Anatomy Skill"),
      ];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.addInitScript(() => {
        window.EventSource = class {
          constructor() {
            this.timer = setTimeout(
              () =>
                this.onmessage?.({
                  data: JSON.stringify({ type: "unavailable", reason: "Synthetic fixture" }),
                }),
              10,
            );
          }
          close() {
            clearTimeout(this.timer);
          }
        };
      });
      await page.route("**/api/**", async (route) => {
        const request = route.request();
        const pathname = decodeURIComponent(new URL(request.url()).pathname);
        if (request.method() === "GET" && pathname === "/api/agents") {
          polls++;
          return route.fulfill({ json: { agents, tabs, workspaces } });
        }
        if (request.method() === "PATCH" && pathname === "/api/agents/backend") {
          mutations.push({ pathname, body: request.postDataJSON() });
          agents[1].name = request.postDataJSON().name;
          return route.fulfill({ json: { ok: true } });
        }
        if (request.method() === "GET" && pathname.startsWith("/api/panes/")) {
          const pane = pathname.split("/")[3];
          return route.fulfill({
            json: {
              pane_id: pane,
              tab_id: "w2:t1",
              workspace_id: "w2",
              revision: 1,
              format: "text",
              source: "visible",
              text: `Synthetic terminal ${pane}`,
              truncated: false,
            },
          });
        }
        errors.push(`Unexpected request: ${request.method()} ${pathname}`);
        return route.fulfill({ status: 500, json: { error: "Unexpected fixture request" } });
      });
      await page.goto(base);
      await page.evaluate(() => document.fonts.ready);
      const cards = page.getByTestId("workspace-disclosure");
      assert.equal(await cards.count(), 3);
      const workspaceHeader = (index) => cards.nth(index).locator(":scope > summary");
      await workspaceHeader(0).click();
      await workspaceHeader(1).click();
      const groups = page.getByTestId("tab-group");
      const orchestrator = groups.filter({
        has: page.locator("strong", { hasText: "orchestrator overhaul" }),
      });
      assert.equal(await orchestrator.count(), 1);
      assert((await workspaceHeader(0).textContent()).includes("5 agents · 1 shell"));
      assert(!(await workspaceHeader(0).textContent()).includes("tabs"));
      assert.equal(await orchestrator.locator(":scope > summary small").textContent(), "Tab");
      assert.equal(await orchestrator.getAttribute("data-split"), "true");
      assert.deepEqual(
        await orchestrator.evaluate((group) => ({
          border: getComputedStyle(group).borderTopWidth,
          background: getComputedStyle(group.querySelector("summary")).backgroundColor,
        })),
        { border: "0px", background: "rgba(0, 0, 0, 0)" },
      );
      assert.equal(await orchestrator.getByTestId("pane-row").count(), 5);
      const single = groups.filter({ has: page.locator("strong", { hasText: "API cleanup" }) });
      assert.equal(await single.locator("summary").count(), 0);
      assert.equal(await single.locator("small").count(), 0);
      assert.equal(await single.getAttribute("data-split"), "false");
      assert.equal(await single.locator("strong").count(), 1);
      assert.equal(
        await single.getByTestId("pane-row").locator("strong").textContent(),
        "API cleanup",
      );
      assert.equal(await cards.nth(1).getByTestId("tab-group").count(), 2);
      assert.equal(await cards.nth(1).locator("summary").count(), 1);
      assert.deepEqual(
        await cards.nth(1).getByTestId("pane-row").locator("strong").allTextContents(),
        ["anatomy skill", "Oculus Quest 3 Anatomy Skill"],
      );
      assert.equal(await cards.nth(1).getByTestId("pane-row").count(), 2);
      assert.equal(await cards.nth(2).getAttribute("open"), null);
      await cards.first().evaluate((card) => {
        card.parentElement.parentElement.scrollTop = 0;
      });
      await page.screenshot({ path: `${out}/${engine}-${width}.png`, fullPage: true });
      // A shell-only workspace must stay a compact list, with no nested tab headers.
      await workspaceHeader(0).click();
      await cards.first().evaluate((card) => {
        card.parentElement.parentElement.scrollTop = 0;
      });
      await page.screenshot({ path: `${out}/${engine}-${width}-shells.png`, fullPage: true });
      await workspaceHeader(0).click();
      // Closing the nested tab must not close its workspace, or reopen on polling.
      await orchestrator.locator(":scope > summary").click();
      assert.equal(await orchestrator.getAttribute("open"), null);
      const beforePoll = polls;
      await page.waitForResponse((response) => new URL(response.url()).pathname === "/api/agents");
      assert(polls > beforePoll);
      assert.equal(await orchestrator.getAttribute("open"), null);
      assert.notEqual(await cards.nth(0).getAttribute("open"), null);
      const search = page.getByRole("searchbox", { name: "Search workspaces" });
      await search.fill("backend");
      assert.equal(await cards.count(), 1);
      assert.equal(await page.getByTestId("pane-row").count(), 1);
      assert(await page.getByTestId("pane-row").isVisible());
      assert.notEqual(await orchestrator.getAttribute("open"), null);
      await search.fill("orchestrator");
      assert.equal(await page.getByTestId("pane-row").count(), 5);
      await search.fill("");
      await orchestrator.locator(":scope > summary").click();
      const backend = orchestrator.getByTestId("pane-row").filter({ hasText: "backend" });
      await backend.click({ button: "right" });
      await page.getByRole("menuitem", { name: "Edit agent", exact: true }).click();
      const dialog = page.getByRole("dialog");
      assert.equal(
        await dialog.getByLabel("Tab name", { exact: true }).inputValue(),
        "orchestrator overhaul",
      );
      assert.equal(await dialog.getByLabel("Agent name", { exact: false }).inputValue(), "backend");
      await dialog.getByLabel("Agent name", { exact: false }).fill("backend-updated");
      await dialog.getByRole("button", { name: "Save", exact: true }).click();
      await dialog.waitFor({ state: "hidden" });
      assert.deepEqual(mutations, [
        { pathname: "/api/agents/backend", body: { name: "backend-updated" } },
      ]);
      await orchestrator.getByTestId("pane-row").filter({ hasText: "backend-updated" }).click();
      await page
        .getByTestId("console-header")
        .getByText(/backend-updated/)
        .waitFor();
      await page.getByRole("button", { name: "Back to overview", exact: true }).click();
      const shellRow = cards
        .nth(1)
        .getByTestId("pane-row")
        .filter({ hasText: "Oculus Quest 3 Anatomy Skill" });
      if ((await cards.nth(1).getAttribute("open")) === null) await workspaceHeader(1).click();
      await shellRow.click();
      await page.getByText("Synthetic terminal w2:p2", { exact: true }).waitFor();
      await page.getByRole("button", { name: "Back to overview", exact: true }).click();
      await page.getByRole("tab", { name: "Agents", exact: true }).click();
      await page.getByRole("searchbox", { name: "Search agents" }).fill("backend-updated");
      assert.equal(await page.getByTestId("pane-row").count(), 1);
      assert(
        (await page.getByTestId("pane-row").textContent()).includes("Tab: orchestrator overhaul"),
      );
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
      );
      assert.deepEqual(errors, []);
      console.log(
        `${engine} ${width}x${height}: PASS grouping, search, collapse, identity, rename and shell target`,
      );
      await page.close();
    }
  } finally {
    await browser.close();
  }
}
