// Synthetic-only browser coverage: no Herdr socket or real sessions are used.
// PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node tools/design/chat-history.mjs URL
import assert from "node:assert/strict";
import fs from "node:fs/promises";
const { chromium, webkit } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.argv[2] || "http://127.0.0.1:5199";
const output = "design-gallery/chat-history";
await fs.mkdir(output, { recursive: true });
const agent = {
  agent: "pi",
  agent_status: "idle",
  focused: false,
  name: "resumed-chat",
  pane_id: "w1:p2",
  tab_id: "w1:t2",
  workspace_id: "w2",
  revision: 1,
  tab_label: "Restore keyboard focus after closing the whiteboard",
};
const chats = [
  {
    id: "a".repeat(64),
    title: agent.tab_label,
    preview: "Investigate the keyboard",
    cwd: "/projects/fernblick",
    updatedAt: "2026-01-02T14:30:00.000Z",
    activePaneId: null,
  },
  {
    id: "b".repeat(64),
    title: "Prepare the API release",
    preview: "Review the release checklist",
    cwd: "/projects/api",
    updatedAt: "2026-01-01T08:00:00.000Z",
    activePaneId: null,
  },
  {
    id: "c".repeat(64),
    title: "An already open conversation",
    preview: "This belongs in Agents",
    cwd: "/projects/current",
    updatedAt: "2026-01-03T08:00:00.000Z",
    activePaneId: "w1:p9",
  },
  ...Array.from({ length: 20 }, (_, i) => ({
    id: (i + 32).toString(16).padStart(64, "0"),
    title: `Earlier conversation ${i + 1}`,
    preview: "",
    cwd: "/projects/archive",
    updatedAt: "2025-12-01T08:00:00.000Z",
    activePaneId: null,
  })),
];
for (const [engine, browserType] of [
  ["chromium", chromium],
  ["webkit", webkit],
]) {
  const browser = await browserType.launch();
  try {
    for (const [device, width, height] of [
      ["small-phone", 320, 568],
      ["phone", 390, 844],
      ["ipad", 834, 1194],
      ["desktop", 1440, 1000],
    ]) {
      const page = await browser.newPage({ viewport: { width, height }, reducedMotion: "reduce" });
      const errors = [];
      const mutations = [];
      let resumed = false;
      page.on("pageerror", (error) => errors.push(error.message));
      await page.addInitScript(() => {
        window.EventSource = class {
          close() {}
        };
      });
      await page.route("**/api/**", async (route) => {
        const url = new URL(route.request().url());
        const method = route.request().method();
        let body;
        if (url.pathname === "/api/agents" && method === "GET")
          body = {
            agents: resumed ? [agent] : [],
            tabs: [],
            workspaces: [
              { workspace_id: "w1", label: "Fernblick" },
              { workspace_id: "w2", label: "API" },
            ],
          };
        else if (url.pathname === "/api/chats" && method === "GET")
          body = {
            chats: chats.map((chat) =>
              resumed && chat.id === chats[0].id ? { ...chat, activePaneId: agent.pane_id } : chat,
            ),
          };
        else if (url.pathname === `/api/chats/${chats[0].id}/resume` && method === "POST") {
          mutations.push(route.request().postDataJSON());
          resumed = true;
          body = { agent };
        } else {
          errors.push(`Unexpected API call: ${method} ${url.pathname}`);
          await route.fulfill({ status: 500, json: { error: "Unexpected API call" } });
          return;
        }
        await route.fulfill({ json: body });
      });
      await page.goto(base);
      await page.getByRole("tab", { name: "Past chats", exact: true }).click();
      await page.getByTestId("saved-chat").first().waitFor();
      assert.equal(await page.getByTestId("saved-chat").count(), 22);
      assert.equal(await page.getByTestId("past-chats").locator("select").count(), 0);
      assert.equal(
        await page
          .getByText("Resume a closed Pi conversation. Open conversations are in Agents.")
          .count(),
        0,
      );
      const search = page.getByRole("searchbox", { name: "Search past chats" });
      assert.equal(
        await page.getByRole("heading", { name: "An already open conversation" }).count(),
        0,
      );
      await search.fill("An already open conversation");
      await page.getByText("No chats match your search.").waitFor();
      await search.fill("/projects/api");
      await page.getByRole("heading", { name: "Prepare the API release" }).waitFor();
      assert.equal(await page.getByTestId("saved-chat").count(), 1);
      await search.fill("not found");
      await page.getByText("No chats match your search.").waitFor();
      await search.fill("");
      assert(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        "No document overflow",
      );
      const tab = await page.getByRole("tab", { name: "Past chats", exact: true }).boundingBox();
      assert(tab && tab.x >= 0 && tab.x + tab.width <= width, "History tab fits");
      await page.screenshot({ path: `${output}/${engine}-${device}.png`, fullPage: true });
      const opener = page.getByRole("button", { name: `Resume ${chats[0].title}`, exact: true });
      const dialog = page.getByRole("dialog", { name: "Open in which workspace?" });
      await opener.click();
      await dialog.waitFor();
      assert.deepEqual(mutations, []);
      assert(
        await dialog
          .getByLabel("Workspace", { exact: true })
          .evaluate((node) => document.activeElement === node),
      );
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "hidden" });
      assert(await opener.evaluate((node) => document.activeElement === node));
      assert.deepEqual(mutations, []);
      await opener.click();
      await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
      await dialog.waitFor({ state: "hidden" });
      assert.deepEqual(mutations, []);
      await opener.click();
      await dialog.getByLabel("Workspace", { exact: true }).selectOption("w2");
      const bounds = await dialog.boundingBox();
      assert(
        bounds &&
          bounds.x >= 0 &&
          bounds.y >= 0 &&
          bounds.x + bounds.width <= width &&
          bounds.y + bounds.height <= height,
      );
      await page.screenshot({
        path: `${output}/${engine}-${device}-resume-dialog.png`,
        fullPage: true,
      });
      await dialog.getByRole("button", { name: "Resume", exact: true }).click();
      await dialog.waitFor({ state: "hidden" });
      await page.waitForFunction(() => document.querySelector('[data-testid="console"]') !== null);
      await page.waitForFunction(
        () => document.querySelectorAll('[data-testid="saved-chat"]').length === 21,
      );
      assert.deepEqual(mutations, [{ workspaceId: "w2" }]);
      assert.deepEqual(errors, []);
      console.log(`${engine} ${device}: history, search, resume, overflow passed`);
      await page.close();
    }
  } finally {
    await browser.close();
  }
}
