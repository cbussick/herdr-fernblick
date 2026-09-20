import { readFile, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve, sep } from "node:path";
import {
  piTreeResponseSchema,
  type PiTreeNode,
  type PiTreeResponse,
} from "../../src/shared/api/contracts.js";

interface Entry {
  id?: string;
  parentId?: string | null;
  type?: string;
  timestamp?: string;
  targetId?: string;
  label?: string | null;
  message?: Record<string, unknown>;
}

function textContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((block) =>
      typeof block === "object" &&
      block &&
      "type" in block &&
      block.type === "text" &&
      "text" in block &&
      typeof block.text === "string"
        ? [block.text]
        : [],
    )
    .join("\n");
}

async function resolveSessionPath(sessionPath: string) {
  const allowedRoot = await realpath(resolve(homedir(), ".pi/agent/sessions"));
  const candidate = resolve(sessionPath);
  if (!candidate.startsWith(`${allowedRoot}${sep}`) || !candidate.endsWith(".jsonl")) {
    throw new Error("Agent session is outside the Pi session directory");
  }
  const resolved = await realpath(candidate);
  if (!resolved.startsWith(`${allowedRoot}${sep}`)) {
    throw new Error("Agent session is outside the Pi session directory");
  }
  return resolved;
}

export async function readPiTree(sessionPath: string): Promise<PiTreeResponse> {
  const source = await readFile(await resolveSessionPath(sessionPath), "utf8");
  if (Buffer.byteLength(source) > 25_000_000)
    throw new Error("Agent session is too large to display");

  const entries = source
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Entry);
  const structural = entries.filter((entry): entry is Entry & { id: string } => Boolean(entry.id));
  const byId = new Map(structural.map((entry) => [entry.id, entry]));
  const labels = new Map<string, string>();
  for (const entry of structural) {
    if (entry.type !== "label" || !entry.targetId) continue;
    if (entry.label) labels.set(entry.targetId, entry.label);
    else labels.delete(entry.targetId);
  }

  const activeIds = new Set<string>();
  let cursor = structural.at(-1);
  while (cursor) {
    activeIds.add(cursor.id);
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
  }

  const visible = structural.flatMap((entry) => {
    if (entry.type !== "message" || !entry.message) return [];
    const role = entry.message.role;
    if (role !== "user" && role !== "assistant") return [];
    const text = textContent(entry.message.content).trim();
    if (!text) return [];
    return [{ entry, role, text }] as const;
  });
  const visibleIds = new Set(visible.map(({ entry }) => entry.id));
  const nearestVisibleParent = (entry: Entry) => {
    let parentId = entry.parentId;
    while (parentId && !visibleIds.has(parentId)) parentId = byId.get(parentId)?.parentId;
    return parentId ?? null;
  };

  const nodes = new Map<string, PiTreeNode>();
  for (const { entry, role, text } of visible) {
    nodes.set(entry.id, {
      id: entry.id,
      parentId: nearestVisibleParent(entry),
      role,
      text,
      timestamp: entry.timestamp,
      label: labels.get(entry.id),
      isActivePath: activeIds.has(entry.id),
      children: [],
    });
  }

  const roots: PiTreeNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.parentId ? nodes.get(node.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const activeNode = [...nodes.values()].findLast((node) => node.isActivePath);
  return piTreeResponseSchema.parse({ roots, leafId: activeNode?.id ?? null });
}
