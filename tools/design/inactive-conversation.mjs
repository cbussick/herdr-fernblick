// Synthetic-only inactive-session layout checks; no Herdr/Pi sockets or commands.
// Run after npm run build: node tools/design/inactive-conversation.mjs
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { resolve } from "node:path";
import { createHttpServer } from "../../dist-server/server/http/server.js";
const { chromium, webkit } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const output = "design-gallery/inactive-conversation";
await fs.mkdir(output, { recursive: true });
const dashboard = {
  agents: [],
  tabs: [],
  workspaces: [{ workspace_id: "w1", label: "Fernblick" }],
};
const chat = {
  id: "a".repeat(64),
  sessionId: "inactive-session",
  title: "What do you think about having routes for each agent, and also for chat and whiteboard?",
  preview: "",
  cwd: "/projects/fernblick",
  updatedAt: "2026-01-01T12:00:00.000Z",
  activePaneId: null,
};
const server = createHttpServer({ getDashboard: async () => dashboard }, resolve("dist"), {});
await new Promise((done) => {
  server.listen(0, "127.0.0.1", done);
});
try {
  for (const [name, engine] of [
    ["chromium", chromium],
    ["webkit", webkit],
  ]) {
    const browser = await engine.launch({ headless: true });
    try {
      for (const width of [320, 390, 834, 1440, 2560]) {
        const page = await browser.newPage({
          viewport: { width, height: 900 },
          serviceWorkers: "block",
        });
        const errors = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.addInitScript(() => {
          window.EventSource = class {
            close() {}
          };
        });
        await page.route("**/api/**", async (route) => {
          const pathname = new URL(route.request().url()).pathname;
          assert.equal(
            route.request().method(),
            "GET",
            "Opening/resuming the screen must not mutate a session",
          );
          if (pathname === "/api/agents") {
            await route.fulfill({ json: dashboard });
          } else if (pathname === "/api/sessions/inactive-session") {
            await route.fulfill({ json: { agent: null, chat } });
          } else if (pathname === "/api/sessions/missing-session") {
            await route.fulfill({ json: { agent: null, chat: null } });
          } else {
            errors.push(`Unexpected API call: ${pathname}`);
            await route.fulfill({ status: 500, json: { error: "Unexpected fixture request" } });
          }
        });
        await page.goto(`http://127.0.0.1:${server.address().port}/sessions/inactive-session/chat`);
        const state = page.getByRole("region", {
          name: "This conversation is inactive",
          exact: true,
        });
        await state.waitFor();
        const resume = state.getByRole("button", { name: "Resume conversation", exact: true });
        const back = state.getByRole("button", { name: "Back to overview", exact: true });
        await page.evaluate(() => document.fonts.ready);
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        for (const button of [resume, back]) {
          const box = await button.boundingBox();
          assert(box.height >= 44);
          assert(box.x >= 0 && box.x + box.width <= width);
          assert.notEqual(
            await button.evaluate((node) => getComputedStyle(node).backgroundColor),
            "rgba(0, 0, 0, 0)",
          );
        }
        assert.notEqual(
          await resume.evaluate((node) => getComputedStyle(node).backgroundColor),
          await back.evaluate((node) => getComputedStyle(node).backgroundColor),
        );
        await page.screenshot({ path: `${output}/${name}-${width}.png` });
        await resume.focus();
        await page.keyboard.press("Enter");
        await page.getByTestId("resume-chat-dialog").waitFor();
        await page.getByRole("button", { name: "Cancel", exact: true }).click();
        await page.getByTestId("resume-chat-dialog").waitFor({ state: "hidden" });
        assert(await resume.evaluate((node) => node === document.activeElement));
        await back.click();
        await page.waitForURL((url) => url.pathname === "/");
        for (const [path, heading, screenshot] of [
          ["/sessions/missing-session/chat", "Conversation or pane unavailable", "unavailable"],
          ["/unknown", "Page not found", "not-found"],
        ]) {
          await page.goto(`http://127.0.0.1:${server.address().port}${path}`);
          const title = page.getByRole("heading", { name: heading, exact: true });
          await title.waitFor();
          const recovery = page.getByRole("button", { name: "Back to overview", exact: true });
          const box = await recovery.boundingBox();
          assert(box.height >= 44 && box.x >= 0 && box.x + box.width <= width);
          assert.notEqual(
            await recovery.evaluate((node) => getComputedStyle(node).backgroundColor),
            "rgba(0, 0, 0, 0)",
          );
          const titleBox = await title.boundingBox();
          assert(
            titleBox.y > 100 && titleBox.y < 650,
            "Recovery content should be vertically centered",
          );
          assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
          await page.screenshot({ path: `${output}/${name}-${width}-${screenshot}.png` });
          await recovery.focus();
          await page.keyboard.press("Enter");
          await page.waitForURL((url) => url.pathname === "/");
        }
        assert.deepEqual(errors, []);
        await page.close();
      }
    } finally {
      await browser.close();
    }
  }
  console.log(
    "PASS: inactive/unavailable conversation and 404 layouts, shared actions, keyboard recovery and overview navigation across five widths in Chromium and WebKit.",
  );
} finally {
  await new Promise((done) => {
    server.close(done);
  });
}
