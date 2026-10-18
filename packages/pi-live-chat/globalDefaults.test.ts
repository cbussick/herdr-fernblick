import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SettingsManager } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { saveGlobalDefault } from "./globalDefaults.js";

let dir: string;
let agentDir: string;
let settingsFile: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "fb-defaults-"));
  agentDir = join(dir, "agent");
  settingsFile = join(agentDir, "settings.json");
  await mkdir(agentDir);
  vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});
const model = { kind: "model", provider: "fixture-provider", modelId: "fixture-model" } as const;
const thinking = { ...model, kind: "thinking", level: "high" } as const;
it("persists global model/provider and thinking independently, preserving other settings and project overrides", async () => {
  const original = {
    theme: "dark",
    defaultProvider: "old",
    defaultModel: "old",
    defaultThinkingLevel: "medium",
    modelThinkingLevels: { "fixture-provider/fixture-model": "low" },
    extensions: ["keep.ts"],
  };
  await writeFile(settingsFile, JSON.stringify(original));
  await mkdir(join(dir, ".pi"));
  const project = JSON.stringify({ defaultModel: "project", defaultThinkingLevel: "off" });
  await writeFile(join(dir, ".pi/settings.json"), project);
  await saveGlobalDefault(dir, model);
  expect(JSON.parse(await readFile(settingsFile, "utf8"))).toEqual({
    ...original,
    defaultProvider: model.provider,
    defaultModel: model.modelId,
  });
  await saveGlobalDefault(dir, thinking);
  const settings = SettingsManager.create(dir, agentDir);
  expect(settings.getGlobalSettings()).toEqual({
    ...original,
    defaultProvider: model.provider,
    defaultModel: model.modelId,
    defaultThinkingLevel: "high",
  });
  expect(settings.getDefaultModel()).toBe("project");
  expect(settings.getDefaultThinkingLevel()).toBe("off");
  expect(await readFile(join(dir, ".pi/settings.json"), "utf8")).toBe(project);
});
it("creates missing settings and merges concurrent saves without dropping fields", async () => {
  await Promise.all([saveGlobalDefault(dir, model), saveGlobalDefault(dir, thinking)]);
  expect(JSON.parse(await readFile(settingsFile, "utf8"))).toEqual({
    defaultProvider: model.provider,
    defaultModel: model.modelId,
    defaultThinkingLevel: "high",
  });
});
it("fails closed on unreadable or malformed global settings and ignores malformed project settings", async () => {
  await writeFile(settingsFile, "{broken");
  await expect(saveGlobalDefault(dir, model)).rejects.toThrow("settings JSON");
  expect(await readFile(settingsFile, "utf8")).toBe("{broken");
  await rm(settingsFile);
  await mkdir(settingsFile);
  await expect(saveGlobalDefault(dir, thinking)).rejects.toThrow("permissions");
  await rm(settingsFile, { recursive: true });
  await mkdir(join(dir, ".pi"));
  await writeFile(join(dir, ".pi/settings.json"), "{broken");
  await saveGlobalDefault(dir, model);
  expect(JSON.parse(await readFile(settingsFile, "utf8")).defaultModel).toBe(model.modelId);
  expect(await readFile(join(dir, ".pi/settings.json"), "utf8")).toBe("{broken");
});
it("reports queued persistence errors rather than treating flush completion as success", async () => {
  const settings = SettingsManager.fromStorage(
    {
      withLock(_scope, update) {
        if (update("{}") !== undefined) throw new Error("disk full");
      },
    },
    { projectTrusted: false },
  );
  vi.spyOn(SettingsManager, "create").mockReturnValueOnce(settings);
  await expect(saveGlobalDefault(dir, model)).rejects.toThrow("Could not save");
});
