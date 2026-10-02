// Synthetic browser regression checks. Every API request is intercepted; no live agent is controlled.
// PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node tools/design/skills.mjs URL
import assert from "node:assert/strict";
import fs from "node:fs/promises";
const { chromium, webkit } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.argv[2] || "http://127.0.0.1:5185";
const output = "design-gallery/skills";
await fs.mkdir(output, { recursive: true });
const target = {
  runtime: "a0000000-0000-4000-8000-000000000001",
  epoch: "a0000000-0000-4000-8000-000000000002",
  sessionId: "skills-fixture",
};
const agent = {
  agent: "pi",
  name: "skills-fixture",
  pane_id: "w1:p1",
  tab_id: "w1:t1",
  tab_label: "Interface design",
  workspace_id: "w1",
  workspace_label: "Fernblick",
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
  capabilities: { skills: true },
  messages: [
    {
      id: "m1",
      role: "assistant",
      text: "The interface is ready for a closer look. Choose a skill to guide the next step.",
    },
  ],
  status: { cwd: "/projects/fernblick", model: "Pi", provider: "fixture", totalTokens: 0, cost: 0 },
};
const skills = [
  {
    name: "animate",
    description:
      "Build motion with purpose. Choose the right properties, easing and interruption behavior.",
    path: "/home/user/.agents/skills/animate/SKILL.md",
    scope: "user",
  },
  {
    name: "code-review",
    description: "Review changes against the project’s standards and the originating spec.",
    path: "/projects/fernblick/.pi/skills/code-review/SKILL.md",
    scope: "project",
  },
  {
    name: "frontend-design",
    description:
      "Build distinctive, intentional interfaces with clear typography and thoughtful layout.",
    path: "/home/user/.pi/agent/skills/frontend-design/SKILL.md",
    scope: "user",
  },
  {
    name: "research",
    description: "Investigate a question using primary sources and capture the findings.",
    path: "/home/user/.pi/agent/npm/package/skills/research/SKILL.md",
    scope: "user",
  },
  ...Array.from({ length: 25 }, (_, i) => ({
    name: `test-skill-${i}`,
    description: "A fixture skill for scrolling and keyboard selection",
    path: `/fixture/${i}/SKILL.md`,
    scope: "temporary",
  })),
];
for (const [engine, browserType] of [
  ["chromium", chromium],
  ["webkit", webkit],
]) {
  const browser = await browserType.launch({ headless: true });
  try {
    for (const [name, width, height] of [
      ["phone", 390, 844],
      ["small-phone", 320, 568],
      ["keyboard-height", 390, 440],
      ["ipad", 834, 1194],
      ["desktop", 1440, 1000],
    ]) {
      const page = await browser.newPage({ viewport: { width, height }, reducedMotion: "reduce" });
      const errors = [];
      let mode = "ready";
      let calls = 0;
      let sends = 0;
      page.on("pageerror", (error) => errors.push(error.message));
      await page.addInitScript((initial) => {
        window.EventSource = class {
          constructor() {
            window.fixtureStream = this;
            this.timer = setTimeout(() => this.onmessage?.({ data: JSON.stringify(initial) }), 30);
          }
          close() {
            clearTimeout(this.timer);
          }
        };
      }, snapshot);
      await page.route(
        (url) => url.pathname.startsWith("/api/"),
        async (route) => {
          const url = new URL(route.request().url());
          if (url.pathname === "/api/agents")
            return route.fulfill({
              json: {
                agents: [agent],
                workspaces: [{ workspace_id: "w1", label: "Fernblick" }],
                tabs: [],
              },
            });
          if (url.pathname.endsWith("/skills")) {
            calls++;
            if (mode === "error")
              return route.fulfill({ status: 503, json: { error: "Skills offline" } });
            return route.fulfill({
              json: {
                type: "skills",
                id: target.runtime,
                target,
                skills: mode === "empty" ? [] : skills,
                truncated: false,
              },
            });
          }
          if (url.pathname.endsWith("/prompt")) {
            sends++;
            return route.fulfill({
              json: {
                type: "ack",
                id: route.request().postDataJSON().requestId,
                outcome: "invoked",
              },
            });
          }
          return route.fulfill({
            status: 503,
            json: { error: "Fixture denies unexpected API request" },
          });
        },
      );
      await page.goto(base);
      await page.getByRole("tab", { name: "Agents", exact: true }).click();
      await page.getByTestId("pane-row").click();
      const prompt = page.locator("#agent-prompt");
      const trigger = page.getByRole("button", { name: "Skills", exact: true });
      await prompt.fill("Review the mobile layout");
      await trigger.click();
      await page.getByRole("option").first().waitFor();
      assert.equal(
        await page.getByRole("combobox").evaluate((el) => el === document.activeElement),
        true,
      );
      assert.equal(calls, 1);
      await page.screenshot({ path: `${output}/${engine}-${name}.png` });
      const bounds = await page.evaluate(() => {
        const send = document.querySelector('[aria-label="Send message"]').getBoundingClientRect();
        return {
          scroll: document.documentElement.scrollWidth,
          client: document.documentElement.clientWidth,
          bottom: send.bottom,
          height: innerHeight,
        };
      });
      assert.ok(bounds.scroll <= bounds.client, `${engine}/${name}: horizontal overflow`);
      assert.ok(bounds.bottom <= bounds.height + 1, `${engine}/${name}: send off screen`);
      await page.getByRole("combobox").fill("no-such-skill");
      await page.getByRole("combobox").press("Enter");
      assert.equal(sends, 0, "search Enter with no results must not submit the draft");
      assert.equal(await prompt.inputValue(), "Review the mobile layout");
      await page.getByRole("combobox").fill("standards");
      assert.equal(await page.getByRole("option").count(), 1);
      assert.equal(calls, 1, "search filters locally");
      await page.getByRole("combobox").press("Enter");
      assert.equal(await prompt.inputValue(), "/skill:code-review Review the mobile layout");
      assert.equal(sends, 0);
      assert.equal(await prompt.evaluate((el) => el === document.activeElement), true);
      await prompt.fill("/");
      await page.getByRole("option").first().waitFor();
      await prompt.press("ArrowDown");
      await prompt.press("Tab");
      assert.equal(await prompt.inputValue(), "/skill:code-review ");
      assert.equal(sends, 0);
      await trigger.click();
      await page.getByRole("option").first().waitFor();
      await page.getByRole("combobox").press("Escape");
      assert.equal(await page.getByTestId("skill-picker").count(), 0);
      assert.equal(await prompt.inputValue(), "/skill:code-review ");
      await trigger.click();
      await page.getByRole("option").first().waitFor();
      await page.getByRole("option").filter({ hasText: "frontend-design" }).click();
      assert.equal(await prompt.inputValue(), "/skill:frontend-design ");
      await prompt.fill("/nothing-matches");
      await page.getByText("No matching skills. Try a name or description.").waitFor();
      await prompt.press("Escape");
      mode = "error";
      await trigger.click();
      await page.getByText("Skills offline").waitFor();
      await page.getByRole("combobox").press("Enter");
      assert.equal(sends, 0, "search Enter after an error must not submit the draft");
      mode = "empty";
      await page.getByRole("button", { name: "Try again" }).click();
      await page.getByText("No skills loaded. Add a skill to Pi, then run /reload.").waitFor();
      await page.getByRole("combobox").press("Escape");
      mode = "ready";
      await prompt.fill("/skill:code-review check this");
      await page.getByRole("button", { name: "Send message" }).click();
      await page.waitForFunction(() => document.querySelector("#agent-prompt").value === "");
      assert.equal(sends, 1, "only the explicit send action forwards");
      await trigger.click();
      await page.getByRole("option").first().waitFor();
      await page.evaluate(() => window.fixtureStream.onerror?.());
      await page.getByText("Connect to Pi live chat to browse this agent’s skills.").waitFor();
      assert.equal(await page.getByRole("option").count(), 0);
      await page.evaluate((initial) => {
        window.savedEditor = document.querySelector("#agent-prompt");
        window.fixtureStream.onmessage?.({
          data: JSON.stringify({
            ...initial,
            seq: 2,
            epoch: "a0000000-0000-4000-8000-000000000099",
          }),
        });
      }, snapshot);
      await page.waitForFunction(() => !document.querySelector('[data-testid="skill-picker"]'));
      assert.equal(
        await page.evaluate(() => window.savedEditor === document.querySelector("#agent-prompt")),
        true,
        "session updates must not replace the editor DOM",
      );
      assert.deepEqual(errors, []);
      console.log(
        `${engine}/${name}: skills, draft, focus, keyboard, errors, disconnect, layout passed`,
      );
      await page.close();
    }
  } finally {
    await browser.close();
  }
}
