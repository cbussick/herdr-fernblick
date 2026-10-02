import type { SlashCommandInfo } from "@earendil-works/pi-coding-agent";
import { expect, it } from "vitest";
import { loadedSkills, skillCatalog, skillPrompt } from "./skills.js";

function skill(name: string, path = `/project/.pi/skills/${name}/SKILL.md`): SlashCommandInfo {
  return {
    name: `skill:${name}`,
    description: `Use ${name}`,
    source: "skill",
    sourceInfo: {
      path,
      source: "local",
      scope: "project",
      origin: "top-level",
    },
  };
}
it("uses live resolved skills from all sources, preserving Pi's duplicate winner and provenance", () => {
  const commands = [
    skill("zebra", "/home/user/.agents/skills/zebra/SKILL.md"),
    skill("review"),
    skill("review", "/losing/duplicate"),
    { ...skill("reload"), name: "reload", source: "extension" as const },
  ];
  const pi = { getCommands: () => commands };
  expect(loadedSkills(pi).map((s) => [s.name, s.path])).toEqual([
    ["review", "/project/.pi/skills/review/SKILL.md"],
    ["zebra", "/home/user/.agents/skills/zebra/SKILL.md"],
  ]);
  commands.push(skill("new"));
  expect(loadedSkills(pi).map((s) => s.name)).toContain("new");
});
it("does not offer commands shadowed by extensions or pass arbitrary slash commands to dispatch", () => {
  const pi = {
    getCommands: () => [skill("review"), { ...skill("review"), source: "extension" as const }],
  };
  expect(loadedSkills(pi)).toEqual([]);
  expect(() => skillPrompt(pi, "/skill:review")).toThrow("unavailable");
  expect(skillPrompt(pi, "/reload")).toEqual({ text: "/reload", expandPromptTemplates: false });
  expect(skillPrompt(pi, "Discuss /skill:review")).toEqual({
    text: "Discuss /skill:review",
    expandPromptTemplates: false,
  });
});
it("keeps skills that share a name with prompt templates, which expand after skills", () => {
  const pi = {
    getCommands: () => [skill("review"), { ...skill("review"), source: "prompt" as const }],
  };
  expect(loadedSkills(pi).map((s) => s.name)).toEqual(["review"]);
  expect(skillPrompt(pi, "/skill:review").expandPromptTemplates).toBe(true);
});
it("normalizes newline/tab arguments for Pi's literal-space parser and rejects unavailable skills", () => {
  const pi = { getCommands: () => [skill("review")] };
  expect(skillPrompt(pi, "/skill:review\ncheck this\ncarefully")).toEqual({
    text: "/skill:review check this\ncarefully",
    expandPromptTemplates: true,
  });
  expect(skillPrompt(pi, "/skill:review")).toEqual({
    text: "/skill:review",
    expandPromptTemplates: true,
  });
  expect(() => skillPrompt(pi, "/skill:missing")).toThrow("unavailable");
  expect(() => skillPrompt(pi, "/skill:")).toThrow("unavailable");
});
it("bounds catalogue metadata and count and ignores names Pi cannot address unambiguously", () => {
  const commands: SlashCommandInfo[] = Array.from({ length: 1001 }, (_, i) => ({
    ...skill(`skill-${i}`),
    description: "Use this skill",
  }));
  commands.push(skill("invalid space"));
  const catalog = skillCatalog({ getCommands: () => commands });
  expect(catalog.skills).toHaveLength(1000);
  expect(catalog.truncated).toBe(true);
  const large = skillCatalog({
    getCommands: () =>
      commands.map((c) => ({
        ...c,
        description: "界".repeat(3000),
        sourceInfo: { ...c.sourceInfo, path: "/".repeat(4096) },
      })),
  });
  expect(large.truncated).toBe(true);
  expect(large.skills[0].description).toHaveLength(2048);
  expect(Buffer.byteLength(JSON.stringify(large))).toBeLessThan(513 * 1024);
  expect(catalog.skills.some((s) => s.name.includes(" "))).toBe(false);
});
