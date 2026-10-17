// Synthetic-only regression: every API request is intercepted; no real agents are created.
// PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node tools/design/agent-workspace.mjs URL
import assert from "node:assert/strict";
const { chromium, webkit } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.argv[2] || "http://127.0.0.1:5201";
for (const [engine, browserType] of [
  ["chromium", chromium],
  ["webkit", webkit],
]) {
  const browser = await browserType.launch();
  try {
    for (const [device, width, height] of [
      ["phone", 390, 844],
      ["ipad", 834, 1194],
      ["desktop", 1440, 1000],
    ]) {
      const page = await browser.newPage({ viewport: { width, height } });
      const errors = [];
      const agentRequests = [];
      let failWorkspace = true;
      let workspaceCreated = false;
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route("**/api/**", async (route) => {
        const request = route.request();
        const path = new URL(request.url()).pathname;
        if (path === "/api/agents" && request.method() === "GET") {
          await route.fulfill({
            json: {
              agents: [],
              tabs: [],
              workspaces: [
                { workspace_id: "w1", label: "Existing" },
                ...(workspaceCreated ? [{ workspace_id: "w2", label: "New project" }] : []),
              ],
            },
          });
        } else if (path === "/api/workspaces" && request.method() === "POST") {
          assert.deepEqual(request.postDataJSON(), { label: "New project", cwd: "/projects/new" });
          if (failWorkspace) {
            failWorkspace = false;
            await route.fulfill({ status: 500, json: { error: "Directory unavailable" } });
          } else {
            workspaceCreated = true;
            await route.fulfill({
              json: { workspace: { workspace_id: "w2", label: "New project" } },
            });
          }
        } else if (path === "/api/agents" && request.method() === "POST") {
          agentRequests.push(request.postDataJSON());
          await route.fulfill({ status: 500, json: { error: "Fixture agent not started" } });
        } else {
          errors.push(`Unexpected API call: ${request.method()} ${path}`);
          await route.fulfill({ status: 500, json: { error: "Unexpected API call" } });
        }
      });
      await page.goto(base);
      await page.getByRole("button", { name: "Open create menu", exact: true }).click();
      await page.getByRole("button", { name: /New Agent/ }).click();
      const agentDialog = page
        .locator("dialog")
        .filter({ has: page.locator("#new-agent-name") })
        .first();
      const agentForm = agentDialog.locator(":scope > form");
      const workspaceDialog = page.getByRole("dialog", { name: "New workspace", exact: true });
      const openWorkspace = () =>
        agentForm.getByRole("button", { name: "+ Create a new workspace", exact: true }).click();
      await page.getByLabel("Agent name (optional)", { exact: true }).fill("my-agent");
      await page.getByLabel("Tab name (optional)", { exact: true }).fill("My tab");

      for (const cancel of ["button", "escape"]) {
        await openWorkspace();
        await workspaceDialog.waitFor();
        if (cancel === "button")
          await workspaceDialog.getByRole("button", { name: "Cancel", exact: true }).click();
        else await page.keyboard.press("Escape");
        await workspaceDialog.waitFor({ state: "detached" });
        assert.equal(await agentDialog.evaluate((node) => node.open), true);
        assert.equal(
          await page.getByLabel("Agent name (optional)", { exact: true }).inputValue(),
          "my-agent",
        );
        assert.equal(await page.getByLabel("Workspace", { exact: true }).inputValue(), "w1");
      }

      await openWorkspace();
      await workspaceDialog.getByLabel("Workspace name", { exact: true }).fill("New project");
      await workspaceDialog.getByLabel("Working directory", { exact: true }).fill("/projects/new");
      await workspaceDialog.getByRole("button", { name: "Create workspace", exact: true }).click();
      await workspaceDialog.getByRole("alert").waitFor();
      assert.equal(await workspaceDialog.getByRole("alert").textContent(), "Directory unavailable");
      assert.equal(agentRequests.length, 0);
      await workspaceDialog.getByRole("button", { name: "Create workspace", exact: true }).click();
      await workspaceDialog.waitFor({ state: "detached" });
      assert.equal(await agentDialog.evaluate((node) => node.open), true);
      assert.equal(await page.getByLabel("Workspace", { exact: true }).inputValue(), "w2");
      assert.equal(
        await page.getByLabel("Agent name (optional)", { exact: true }).inputValue(),
        "my-agent",
      );
      assert.equal(
        await page.getByLabel("Tab name (optional)", { exact: true }).inputValue(),
        "My tab",
      );
      assert.equal(
        await agentDialog.evaluate((node) => node.contains(document.activeElement)),
        true,
      );
      assert.equal(agentRequests.length, 0);
      await agentForm.getByRole("button", { name: "Create agent", exact: true }).click();
      await agentForm.getByRole("alert").waitFor();
      assert.deepEqual(agentRequests, [
        { name: "my-agent", tabLabel: "My tab", workspaceId: "w2" },
      ]);
      await agentForm.getByRole("button", { name: "Cancel", exact: true }).click();
      assert.equal(await agentDialog.evaluate((node) => node.open), false);
      assert.deepEqual(errors, []);
      console.log(
        `${engine} ${device}: cancel, Escape, retry, draft, selection, explicit confirmation passed`,
      );
      await page.close();
    }
  } finally {
    await browser.close();
  }
}
