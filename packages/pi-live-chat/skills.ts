import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { MAX_SKILLS, skillSchema, type AgentSkill } from "./protocol.js";

// Ask the active runtime, not the backend filesystem: Pi has already applied
// project trust, resource filters, packages, CLI flags and duplicate precedence.
export function loadedSkills(pi: Pick<ExtensionAPI, "getCommands">) {
  const commands = pi.getCommands();
  const shadowed = new Set(commands.filter((c) => c.source === "extension").map((c) => c.name));
  const skills = new Map<string, AgentSkill>();
  for (const command of commands) {
    if (
      command.source !== "skill" ||
      !command.name.startsWith("skill:") ||
      shadowed.has(command.name)
    )
      continue;
    const parsed = skillSchema.safeParse({
      name: command.name.slice(6),
      description: (command.description ?? "").slice(0, 2048),
      path: command.sourceInfo.path.slice(0, 4096),
      scope: command.sourceInfo.scope,
    });
    if (parsed.success && !skills.has(parsed.data.name)) skills.set(parsed.data.name, parsed.data);
  }
  return [...skills.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function skillCatalog(pi: Pick<ExtensionAPI, "getCommands">) {
  const all = loadedSkills(pi);
  const skills: AgentSkill[] = [];
  let bytes = 0;
  for (const skill of all) {
    bytes += Buffer.byteLength(JSON.stringify(skill), "utf8") + 1;
    // Metadata must fit even with long paths or multibyte descriptions.
    if (skills.length >= MAX_SKILLS || bytes > 512 * 1024) break;
    skills.push(skill);
  }
  return { skills, truncated: skills.length < all.length };
}

// Ordinary slash text stays literal. Only an exact, currently loaded skill can
// opt into Pi's command expansion; never dispatch arbitrary extension commands.
export function skillPrompt(pi: Pick<ExtensionAPI, "getCommands">, text: string) {
  if (!text.startsWith("/skill:")) return { text, expandPromptTemplates: false };
  const match = /^\/skill:([^\s]+)(?:\s+([\s\S]*))?$/.exec(text);
  if (!match || !loadedSkills(pi).some((skill) => skill.name === match[1]))
    throw new Error("Skill unavailable in this Pi session. Reopen Skills to refresh.");
  return {
    text: `/skill:${match[1]}${match[2] ? ` ${match[2]}` : ""}`,
    expandPromptTemplates: true,
  };
}
