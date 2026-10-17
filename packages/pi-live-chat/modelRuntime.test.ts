import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { expect, it } from "vitest";

it("uses real Pi's public model API, records the selection and leaves global defaults unchanged without provider calls", async () => {
  const root = resolve("node_modules/.tmp");
  await mkdir(root, { recursive: true });
  const dir = await mkdtemp(join(root, "pi-models-"));
  const home = join(dir, "home");
  const agentDir = join(home, ".pi/agent");
  const sdk = pathToFileURL(
    resolve("node_modules/@earendil-works/pi-coding-agent/dist/index.js"),
  ).href;
  try {
    await mkdir(agentDir, { recursive: true });
    await writeFile(
      join(agentDir, "settings.json"),
      JSON.stringify({
        defaultProvider: "keep",
        defaultModel: "keep",
        defaultThinkingLevel: "medium",
      }),
    );
    const result = await promisify(execFile)(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
      import assert from 'node:assert/strict';
      import { readFile } from 'node:fs/promises';
      const { createAgentSession, DefaultResourceLoader, SettingsManager, SessionManager, ModelRuntime } = await import(${JSON.stringify(sdk)});
      const cwd = ${JSON.stringify(dir)}, agentDir = ${JSON.stringify(agentDir)};
      let pi, context;
      const settingsManager = SettingsManager.create(cwd, agentDir);
      const resourceLoader = new DefaultResourceLoader({ cwd, agentDir, settingsManager,
        noExtensions: true, noSkills: true, noThemes: true, noPromptTemplates: true, noContextFiles: true,
        extensionFactories: [(api) => { pi = api; api.on('session_start', (_event, ctx) => { context = ctx; }); }],
      });
      await resourceLoader.reload();
      const runtime = await ModelRuntime.create({ authPath: agentDir + '/auth.json', modelsPath: null, refreshOnCreate: false });
      await runtime.setRuntimeApiKey('openai', 'fixture-not-a-real-key');
      const [first, second] = runtime.getModels('openai');
      assert.ok(first && second);
      const sessionManager = SessionManager.inMemory(cwd);
      const { session } = await createAgentSession({ cwd, agentDir, settingsManager, resourceLoader,
        sessionManager, modelRuntime: runtime, model: first, tools: [] });
      try {
        await session.bindExtensions({ mode: 'print' });
        assert.ok(context.modelRegistry.getAvailable().some(m => m.provider === second.provider && m.id === second.id));
        session.agent.prompt = () => { throw new Error('Never prompt'); };
        session.agent.streamFunction = () => { throw new Error('Never call a provider'); };
        assert.equal(await pi.setModel(second), true);
        assert.equal(session.model.id, second.id);
        assert.ok(sessionManager.getBranch().some(e => e.type === 'model_change' && e.modelId === second.id));
        assert.equal(settingsManager.getSettings().defaultModel, 'keep');
        assert.equal(JSON.parse(await readFile(agentDir + '/settings.json', 'utf8')).defaultModel, 'keep');
        assert.equal(await pi.setModel({ ...first, provider: 'unconfigured-fixture' }), false);
        assert.equal(session.model.id, second.id);
        const { getSupportedThinkingLevels } = await import('@earendil-works/pi-ai/compat');
        const thinkingModel = { ...second, reasoning: true, thinkingLevelMap: { off: null, minimal: null, xhigh: 'extra', max: 'maximum' } };
        assert.equal(await pi.setModel(thinkingModel), true);
        assert.deepEqual(session.getAvailableThinkingLevels(), getSupportedThinkingLevels(thinkingModel));
        assert.deepEqual(session.getAvailableThinkingLevels(), ['low', 'medium', 'high', 'xhigh', 'max']);
        pi.setThinkingLevel('max');
        assert.equal(pi.getThinkingLevel(), 'max');
        assert.ok(sessionManager.getBranch().some(e => e.type === 'thinking_level_change' && e.thinkingLevel === 'max'));
        assert.equal(settingsManager.getSettings().defaultThinkingLevel, 'medium');
        assert.equal(JSON.parse(await readFile(agentDir + '/settings.json', 'utf8')).defaultThinkingLevel, 'medium');
        assert.equal(await pi.setModel({ ...second, reasoning: false }), true);
        assert.deepEqual(session.getAvailableThinkingLevels(), ['off']);
        assert.equal(pi.getThinkingLevel(), 'off');
        console.log('Verified native model selection');
      } finally { session.dispose(); }
    `,
      ],
      {
        cwd: dir,
        env: { ...process.env, HOME: home, PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: "1" },
        timeout: 30_000,
      },
    );
    expect(result.stdout).toContain("Verified native model selection");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 40_000);
