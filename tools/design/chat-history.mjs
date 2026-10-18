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
  pane_id: "w3:p1",
  tab_id: "w3:t1",
  workspace_id: "w3",
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
      const creations = [];
      let createdWorkspace;
      const existingWorkspaces =
        device === "small-phone"
          ? []
          : [
              { workspace_id: "w1", label: "Fernblick" },
              { workspace_id: "w2", label: "API" },
            ];
      let resumed = false;
      let deleted = false;
      let deletionAttempts = 0;
      let releaseDelete;
      const deletionReady = new Promise((resolve) => {
        releaseDelete = resolve;
      });
      let releaseHistory;
      const historyReady = new Promise((resolve) => {
        releaseHistory = resolve;
      });
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
            workspaces: [...existingWorkspaces, ...(createdWorkspace ? [createdWorkspace] : [])],
          };
        else if (url.pathname === "/api/chats" && method === "GET") {
          await historyReady;
          body = {
            chats: chats
              .filter((chat) => !deleted || chat.id !== chats[1].id)
              .map((chat) =>
                resumed && chat.id === chats[0].id
                  ? { ...chat, activePaneId: agent.pane_id }
                  : chat,
              ),
          };
        } else if (url.pathname === `/api/chats/${chats[1].id}` && method === "DELETE") {
          deletionAttempts++;
          if (deletionAttempts === 1) {
            await route.fulfill({
              status: 409,
              json: { error: "This session is active. Close it first." },
            });
            return;
          }
          await deletionReady;
          deleted = true;
          body = { ok: true, sessionId: "deleted-session", boardIds: ["e".repeat(64)] };
        } else if (url.pathname === "/api/workspaces" && method === "POST") {
          const input = route.request().postDataJSON();
          creations.push(input);
          createdWorkspace = { workspace_id: "w3", label: input.label };
          body = { workspace: createdWorkspace };
        } else if (url.pathname === `/api/chats/${chats[0].id}/resume` && method === "POST") {
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
      await page.getByRole("tab", { name: "Past sessions", exact: true }).click();
      const loading = page.getByTestId("past-chats").getByRole("status");
      await loading.waitFor();
      assert.equal(await loading.textContent(), "Loading past sessions…");
      assert.equal(await loading.getAttribute("aria-busy"), "true");
      const spinner = loading.locator("svg");
      assert.equal(await spinner.evaluate((node) => getComputedStyle(node).animationName), "none");
      await page.emulateMedia({ reducedMotion: "no-preference" });
      assert.notEqual(
        await spinner.evaluate((node) => getComputedStyle(node).animationName),
        "none",
      );
      await page.emulateMedia({ reducedMotion: "reduce" });
      assert.equal(await page.getByTestId("saved-chat").count(), 0);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.screenshot({ path: `${output}/${engine}-${device}-loading.png`, fullPage: true });
      releaseHistory();
      await page.getByTestId("saved-chat").first().waitFor();
      await loading.waitFor({ state: "hidden" });
      assert.equal(await page.getByTestId("saved-chat").count(), 22);
      assert.equal(await page.getByTestId("past-chats").locator("select").count(), 0);
      assert.equal(
        await page.getByRole("button", { name: "Refresh chats", exact: true }).count(),
        0,
      );
      const cardStyle = await page
        .getByTestId("saved-chat")
        .first()
        .evaluate((card) => ({
          background: getComputedStyle(card).backgroundColor,
          radius: parseFloat(getComputedStyle(card).borderRadius),
        }));
      assert.equal(cardStyle.background, "rgb(255, 255, 255)");
      assert(cardStyle.radius > 0, "Chat rows are rounded cards");
      assert.equal(
        await page
          .getByText("Resume a closed Pi conversation. Open conversations are in Agents.")
          .count(),
        0,
      );
      const search = page.getByRole("searchbox", { name: "Search past sessions" });
      assert.equal(
        await page.getByRole("heading", { name: "An already open conversation" }).count(),
        0,
      );
      await search.fill("An already open conversation");
      await page.getByText("No sessions match your search.").waitFor();
      await search.fill("/projects/api");
      await page.getByRole("heading", { name: "Prepare the API release" }).waitFor();
      assert.equal(await page.getByTestId("saved-chat").count(), 1);
      await search.fill("not found");
      await page.getByText("No sessions match your search.").waitFor();
      await search.fill("");
      assert(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        "No document overflow",
      );
      const tab = await page.getByRole("tab", { name: "Past sessions", exact: true }).boundingBox();
      assert(tab && tab.x >= 0 && tab.x + tab.width <= width, "History tab fits");
      await page.screenshot({ path: `${output}/${engine}-${device}.png`, fullPage: true });
      await page.evaluate(async () => {
        const db = await new Promise((resolve, reject) => {
          const request = indexedDB.open("fernblick-whiteboards", 1);
          request.onupgradeneeded = () => request.result.createObjectStore("drafts");
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        await new Promise((resolve, reject) => {
          const tx = db.transaction("drafts", "readwrite");
          const drafts = tx.objectStore("drafts");
          drafts.put({ boardId: "d".repeat(64) }, JSON.stringify(["old-pane", "deleted-session"]));
          drafts.put({ boardId: "e".repeat(64) }, JSON.stringify(["another-pane", "old-key"]));
          drafts.put({ boardId: "f".repeat(64) }, JSON.stringify(["kept-pane", "kept-session"]));
          tx.oncomplete = resolve;
          tx.onabort = () => reject(tx.error);
        });
        db.close();
      });
      const deleteOpener = page.getByRole("button", {
        name: `Delete ${chats[1].title}`,
        exact: true,
      });
      const deleteDialog = page.getByRole("dialog", { name: "Delete session?", exact: true });
      await deleteOpener.click();
      await deleteDialog.waitFor();
      const cancelDelete = deleteDialog.getByRole("button", { name: "Cancel", exact: true });
      assert(await cancelDelete.evaluate((node) => document.activeElement === node));
      await page.keyboard.press("Escape");
      await deleteDialog.waitFor({ state: "hidden" });
      assert(await deleteOpener.evaluate((node) => document.activeElement === node));
      assert.equal(deletionAttempts, 0);
      assert.equal(await page.getByTestId("snackbar").count(), 0);
      await deleteOpener.click();
      await cancelDelete.click();
      await deleteDialog.waitFor({ state: "hidden" });
      assert.equal(deletionAttempts, 0);
      await deleteOpener.click();
      const confirmDelete = deleteDialog.getByRole("button", {
        name: "Delete session",
        exact: true,
      });
      await confirmDelete.click();
      await deleteDialog.getByRole("alert").waitFor();
      assert.equal(await page.getByTestId("snackbar").count(), 0);
      assert.equal(await page.getByTestId("saved-chat").count(), 22);
      await page.screenshot({
        path: `${output}/${engine}-${device}-delete-dialog.png`,
        fullPage: true,
      });
      await confirmDelete.click();
      await page.waitForFunction(
        () =>
          document
            .querySelector('[data-testid="delete-chat-dialog"] form')
            ?.getAttribute("aria-busy") === "true",
      );
      assert(await cancelDelete.isDisabled());
      await page.keyboard.press("Escape");
      assert(await deleteDialog.isVisible());
      assert.equal(await page.getByTestId("snackbar").count(), 0);
      releaseDelete();
      await deleteDialog.waitFor({ state: "hidden" });
      await page.waitForFunction(
        () => document.querySelectorAll('[data-testid="saved-chat"]').length === 21,
      );
      assert.equal(deletionAttempts, 2);
      await page.waitForFunction(async () => {
        const request = indexedDB.open("fernblick-whiteboards", 1);
        const db = await new Promise((resolve) => {
          request.onsuccess = () => resolve(request.result);
        });
        try {
          return await new Promise((resolve) => {
            const read = db.transaction("drafts", "readonly").objectStore("drafts").getAllKeys();
            read.onsuccess = () =>
              resolve(
                JSON.stringify(read.result) ===
                  JSON.stringify([JSON.stringify(["kept-pane", "kept-session"])]),
              );
          });
        } finally {
          db.close();
        }
      });
      assert(
        await page.getByTestId("past-chats").evaluate((node) => document.activeElement === node),
      );
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      const snackbar = page.getByTestId("snackbar");
      await snackbar.waitFor();
      assert.equal(await snackbar.getByRole("status").textContent(), "Session removed");
      assert.equal(await snackbar.getByRole("status").getAttribute("aria-live"), "polite");
      const snackBounds = await snackbar.boundingBox();
      const createBounds = await page
        .getByRole("button", { name: "Open create menu", exact: true })
        .boundingBox();
      assert(snackBounds && snackBounds.x >= 0 && snackBounds.x + snackBounds.width <= width);
      assert(snackBounds.y >= 0 && snackBounds.y + snackBounds.height <= height);
      assert(
        createBounds && snackBounds.y + snackBounds.height <= createBounds.y,
        "Removal confirmation must not overlap the create button",
      );
      await page.screenshot({
        path: `${output}/${engine}-${device}-session-removed.png`,
        fullPage: true,
      });
      await page.getByRole("tab", { name: "Workspaces", exact: true }).click();
      assert(await snackbar.isVisible(), "Confirmation survives an overview tab change");
      await page.getByRole("tab", { name: "Past sessions", exact: true }).click();
      await snackbar.getByRole("button", { name: "Dismiss notification", exact: true }).click();
      await snackbar.waitFor({ state: "hidden" });
      const opener = page.getByRole("button", { name: `Resume ${chats[0].title}`, exact: true });
      const dialog = page.getByRole("dialog", { name: "Open in which workspace?" });
      await opener.click();
      await dialog.waitFor();
      assert.deepEqual(mutations, []);
      const firstControl = existingWorkspaces.length
        ? dialog.getByLabel("Workspace", { exact: true })
        : dialog.getByRole("button", { name: "Create new workspace", exact: true });
      assert(await firstControl.evaluate((node) => document.activeElement === node));
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "hidden" });
      assert(await opener.evaluate((node) => document.activeElement === node));
      assert.deepEqual(mutations, []);
      await opener.click();
      await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
      await dialog.waitFor({ state: "hidden" });
      assert.deepEqual(mutations, []);
      await opener.click();
      if (existingWorkspaces.length)
        await dialog.getByLabel("Workspace", { exact: true }).selectOption("w2");
      await dialog.getByRole("button", { name: "Create new workspace", exact: true }).click();
      const creation = page.getByRole("dialog", { name: "New workspace", exact: true });
      await creation.waitFor();
      assert.equal(await page.locator("dialog:modal").count(), 1);
      assert.equal(
        await creation.getByLabel("Working directory", { exact: true }).inputValue(),
        chats[0].cwd,
      );
      assert.equal(
        await creation.getByLabel("Workspace name", { exact: true }).inputValue(),
        "fernblick",
      );
      assert(
        await creation
          .getByLabel("Workspace name", { exact: true })
          .evaluate((node) => document.activeElement === node),
      );
      await page.keyboard.press("Escape");
      await dialog.waitFor();
      assert.equal(await page.locator("dialog:modal").count(), 1);
      assert.deepEqual(creations, []);
      assert.deepEqual(mutations, []);
      if (existingWorkspaces.length)
        assert.equal(await dialog.getByLabel("Workspace", { exact: true }).inputValue(), "w2");
      await dialog.getByRole("button", { name: "Create new workspace", exact: true }).click();
      await creation.waitFor();
      await creation.getByLabel("Workspace name", { exact: true }).fill("Resumed project");
      await page.screenshot({
        path: `${output}/${engine}-${device}-create-workspace.png`,
        fullPage: true,
      });
      await creation.getByRole("button", { name: "Create workspace", exact: true }).click();
      await dialog.waitFor();
      assert.equal(await dialog.getByLabel("Workspace", { exact: true }).inputValue(), "w3");
      assert.deepEqual(creations, [{ label: "Resumed project", cwd: chats[0].cwd }]);
      assert.deepEqual(mutations, []);
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
        () => document.querySelectorAll('[data-testid="saved-chat"]').length === 20,
      );
      assert.deepEqual(mutations, [{ workspaceId: "w3" }]);
      assert.deepEqual(errors, []);
      console.log(
        `${engine} ${device}: loading, reduced motion, history, search, session labels, delete, snackbar, local draft cleanup, resume, focus, overflow passed`,
      );
      await page.close();
    }
  } finally {
    await browser.close();
  }
}
