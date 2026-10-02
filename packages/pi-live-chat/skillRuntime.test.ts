import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { expect, it } from "vitest";

it("uses real Pi discovery across folders, filters and trust, then expands a skill with arguments and images without a model call", async () => {
  const root = resolve("node_modules/.tmp");
  await mkdir(root, { recursive: true });
  const dir = await mkdtemp(join(root, "pi-skills-"));
  const home = join(dir, "home");
  const agentDir = join(home, ".pi/agent");
  const repo = join(dir, "repo");
  const cwd = join(repo, "subproject");
  const addSkill = async (base: string, name: string, body = `Instructions for ${name}`) => {
    const folder = join(base, name);
    await mkdir(folder, { recursive: true });
    await writeFile(
      join(folder, "SKILL.md"),
      `---\nname: ${name}\ndescription: Use ${name}\n---\n${body}`,
    );
    return join(folder, "SKILL.md");
  };
  try {
    await mkdir(join(repo, ".git"), { recursive: true });
    await mkdir(cwd, { recursive: true });
    await addSkill(join(agentDir, "skills"), "personal-pi");
    await addSkill(join(home, ".agents/skills"), "personal-agents");
    await addSkill(join(cwd, ".pi/skills"), "project-pi");
    await addSkill(join(cwd, ".agents/skills"), "project-agents");
    await addSkill(join(repo, ".agents/skills"), "ancestor");
    await addSkill(join(dir, ".agents/skills"), "outside-repo");
    await addSkill(join(agentDir, "skills"), "duplicate", "personal loser");
    await addSkill(join(cwd, ".pi/skills"), "duplicate", "project winner");
    await addSkill(join(agentDir, "skills"), "excluded");
    const explicit = await addSkill(join(dir, "explicit"), "cli-skill");
    const custom = await addSkill(join(dir, "custom"), "configured");
    const pkg = join(dir, "package");
    await addSkill(join(pkg, "skills"), "packaged");
    await writeFile(
      join(pkg, "package.json"),
      JSON.stringify({ name: "fixture", pi: { skills: ["skills"] } }),
    );
    await writeFile(
      join(agentDir, "settings.json"),
      JSON.stringify({
        enableSkillCommands: false,
        skills: [custom, "-skills/excluded"],
        packages: [pkg],
        images: { autoResize: false },
      }),
    );
    const sdk = pathToFileURL(
      resolve("node_modules/@earendil-works/pi-coding-agent/dist/index.js"),
    ).href;
    const result = await promisify(execFile)(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
      import assert from 'node:assert/strict';
      const { createAgentSession, DefaultResourceLoader, SettingsManager, SessionManager, ModelRuntime } = await import(${JSON.stringify(sdk)});
      const cwd = ${JSON.stringify(cwd)}, agentDir = ${JSON.stringify(agentDir)};
      const settingsManager = SettingsManager.create(cwd, agentDir);
      let pi;
      const options = { cwd, agentDir, settingsManager, noExtensions: true, noThemes: true, noPromptTemplates: true, noContextFiles: true };
      const resourceLoader = new DefaultResourceLoader({ ...options, extensionFactories: [(api) => { pi = api; }] });
      await resourceLoader.reload();
      const runtime = await ModelRuntime.create({ authPath: agentDir + '/auth.json', modelsPath: null, refreshOnCreate: false });
      await runtime.setRuntimeApiKey('openai', 'test-not-a-real-key');
      const model = runtime.getModels('openai')[0];
      assert.ok(model);
      const { session } = await createAgentSession({ cwd, agentDir, settingsManager, resourceLoader,
        sessionManager: SessionManager.inMemory(cwd), modelRuntime: runtime, model, tools: [] });
      try {
        await session.bindExtensions({ mode: 'print' });
        const skills = pi.getCommands().filter(c => c.source === 'skill');
        const names = skills.map(s => s.name).sort();
        assert.deepEqual(names, ['ancestor', 'configured', 'duplicate', 'packaged', 'personal-agents', 'personal-pi', 'project-agents', 'project-pi'].map(s => 'skill:' + s).sort());
        assert.ok(skills.find(s => s.name === 'skill:duplicate').sourceInfo.path.startsWith(cwd));
        assert.equal(pi.getSettings().enableSkillCommands, false);
        const delivered = [];
        session.agent.prompt = async (...args) => { delivered.push(args); };
        session.agent.streamFunction = () => { throw new Error('Never call a model'); };
        const image = { type: 'image', mimeType: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2ioAAAAASUVORK5CYII=' };
        pi.sendUserMessage([{ type: 'text', text: '/skill:duplicate inspect this image' }, image], { expandPromptTemplates: true });
        for (let n = 0; !delivered.length && n < 100; n++) await new Promise(r => setTimeout(r, 10));
        const messages = delivered[0][0];
        const text = JSON.stringify(messages);
        assert.ok(text.includes('project winner'));
        assert.ok(text.includes('References are relative to'));
        assert.ok(text.includes('inspect this image'));
        assert.ok(text.includes(image.data));
        assert.ok(!text.includes('personal loser'));
        settingsManager.setProjectTrusted(false);
        const untrusted = new DefaultResourceLoader(options);
        await untrusted.reload();
        assert.ok(!untrusted.getSkills().skills.some(s => s.name.startsWith('project-') || s.name === 'ancestor'));
        const disabled = new DefaultResourceLoader({ ...options, noSkills: true, additionalSkillPaths: [${JSON.stringify(explicit)}] });
        await disabled.reload();
        assert.deepEqual(disabled.getSkills().skills.map(s => s.name), ['cli-skill']);
        console.log('Verified discovery and native expansion');
      } finally { session.dispose(); }
    `,
      ],
      {
        cwd: dir,
        env: { ...process.env, HOME: home, PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: "1" },
        timeout: 30_000,
      },
    );
    expect(result.stdout).toContain("Verified discovery and native expansion");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 40_000);
