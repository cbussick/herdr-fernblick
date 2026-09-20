import { readFile, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve, sep } from "node:path";
import {
  agentTranscriptSchema,
  type AgentTranscript,
  type ChatMessage,
} from "../../src/shared/api/contracts.js";

interface Entry {
  id?: string;
  parentId?: string | null;
  type?: string;
  cwd?: string;
  name?: string;
  provider?: string;
  modelId?: string;
  message?: Record<string, unknown>;
}
export function contentBlocks(content: unknown, type: "text" | "thinking"): string[] {
  if (type === "text" && typeof content === "string") return [content];
  if (!Array.isArray(content)) return [];
  return content.flatMap((block) => {
    if (typeof block !== "object" || !block || !("type" in block) || block.type !== type) return [];
    const field = type === "text" ? "text" : "thinking";
    if (!(field in block) || typeof block[field] !== "string") return [];
    return type === "thinking"
      ? block[field]
          .split(/\n+/)
          .map((line) => line.trim())
          .filter(Boolean)
      : block[field]
        ? [block[field]]
        : [];
  });
}
function number(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
export async function readPiTranscript(
  sessionPath: string,
  fallbackCwd = "Unknown directory",
): Promise<AgentTranscript> {
  const allowedRoot = await realpath(resolve(homedir(), ".pi/agent/sessions"));
  const candidate = resolve(sessionPath);
  if (candidate !== allowedRoot && !candidate.startsWith(`${allowedRoot}${sep}`))
    throw new Error("Agent session is outside the Pi session directory");
  if (!candidate.endsWith(".jsonl")) throw new Error("Agent session must be a JSONL file");
  let resolved: string;
  try {
    resolved = await realpath(candidate);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return agentTranscriptSchema.parse({
        messages: [],
        status: { cwd: fallbackCwd, totalTokens: 0, cost: 0 },
      });
    }
    throw error;
  }
  if (!resolved.startsWith(`${allowedRoot}${sep}`))
    throw new Error("Agent session is outside the Pi session directory");
  const source = await readFile(resolved, "utf8");
  if (Buffer.byteLength(source) > 25_000_000)
    throw new Error("Agent session is too large to display");
  const entries = source
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Entry);
  const header = entries[0];
  const tree = entries.filter((entry) => entry.id);
  const byId = new Map(tree.map((entry) => [entry.id!, entry]));
  let cursor = tree.at(-1);
  const branch: Entry[] = [];
  while (cursor) {
    branch.push(cursor);
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
  }
  branch.reverse();
  let model: string | undefined,
    provider: string | undefined,
    sessionName: string | undefined,
    workingSince: number | undefined,
    totalTokens = 0,
    cost = 0;
  const messages: ChatMessage[] = [];
  for (const entry of branch) {
    if (entry.type === "session_info" && typeof entry.name === "string") sessionName = entry.name;
    if (entry.type === "model_change") {
      model = entry.modelId;
      provider = entry.provider;
    }
    if (entry.type !== "message" || !entry.message) continue;
    const message = entry.message;
    const role = message.role;
    if (role === "user") workingSince = number(message.timestamp) || undefined;
    const rawText = contentBlocks(message.content, "text").join("\n");
    const thinkingBlocks = role === "assistant" ? contentBlocks(message.content, "thinking") : [];
    const attachmentPattern = /\/tmp\/fernblick\/([0-9a-f-]{36}\.(?:png|jpg|gif|webp))/g;
    const attachments =
      role === "user"
        ? Array.from(rawText.matchAll(attachmentPattern), (match) => `/api/uploads/${match[1]}`)
        : [];
    const text = role === "user" ? rawText.replace(attachmentPattern, "").trim() : rawText;
    if (role === "assistant") {
      if (typeof message.model === "string") model = message.model;
      if (typeof message.provider === "string") provider = message.provider;
      const usage =
        typeof message.usage === "object" && message.usage
          ? (message.usage as Record<string, unknown>)
          : {};
      totalTokens += number(usage.totalTokens);
      const costs =
        typeof usage.cost === "object" && usage.cost ? (usage.cost as Record<string, unknown>) : {};
      cost += number(costs.total);
    }
    const wasStopped =
      role === "assistant" &&
      typeof message.errorMessage === "string" &&
      /abort/i.test(message.errorMessage);
    if (wasStopped) {
      messages.push({
        id: entry.id!,
        role: "status",
        text: "Agent stopped",
        timestamp: number(message.timestamp) || undefined,
      });
      continue;
    }
    const timestamp = number(message.timestamp) || undefined;
    thinkingBlocks.forEach((thinking, index) =>
      messages.push({
        id: `${entry.id!}-thinking-${index}`,
        role: "thinking",
        text: thinking,
        timestamp,
      }),
    );
    if (text || attachments.length) {
      if (role === "user" || role === "assistant")
        messages.push({
          id: entry.id!,
          role,
          text,
          timestamp,
          attachments: attachments.length ? attachments : undefined,
        });
      else if (role === "toolResult")
        messages.push({
          id: entry.id!,
          role: "tool",
          text,
          toolName: typeof message.toolName === "string" ? message.toolName : "Tool",
          isError: message.isError === true,
          timestamp,
        });
    }
  }
  return agentTranscriptSchema.parse({
    messages,
    status: {
      cwd: typeof header?.cwd === "string" ? header.cwd : "Unknown directory",
      model,
      provider,
      sessionName,
      workingSince,
      totalTokens,
      cost,
    },
  });
}
