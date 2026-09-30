import type { ExtensionContext, SessionTreeNode } from "@earendil-works/pi-coding-agent";
import { MAX_SNAPSHOT, MAX_TEXT, type PiTree, type PiTreeNode } from "./protocol.js";

export function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((b) =>
      b && typeof b === "object" && b.type === "text" && typeof b.text === "string" ? [b.text] : [],
    )
    .join("\n");
}
export function projectTree(
  manager: Pick<ExtensionContext["sessionManager"], "getTree" | "getLeafId">,
): PiTree {
  const raw = manager.getTree();
  const byId = new Map<string, { node: PiTreeNode | undefined; parent: string | null }>();
  const roots: PiTreeNode[] = [];
  const stack: { raw: SessionTreeNode; visibleParent?: PiTreeNode; depth: number }[] = raw
    .map((node) => ({ raw: node, depth: 0 }))
    .reverse();
  while (stack.length) {
    const { raw: item, visibleParent, depth } = stack.pop()!;
    if (byId.size >= 2000 || depth > 256)
      throw new Error("Conversation tree is too large to display safely");
    const e = item.entry;
    let node: PiTreeNode | undefined;
    if (e.type === "message" && (e.message.role === "user" || e.message.role === "assistant")) {
      const text = contentText(e.message.content);
      if (text.trim() || e.message.role === "user") {
        node = {
          id: e.id,
          parentId: visibleParent?.id ?? null,
          role: e.message.role,
          text: text.slice(0, MAX_TEXT),
          timestamp: e.timestamp,
          label: item.label?.slice(0, 256),
          isActivePath: false,
          children: [],
        };
        if (visibleParent) visibleParent.children.push(node);
        else roots.push(node);
      }
    }
    byId.set(e.id, { node, parent: e.parentId });
    for (let i = item.children.length - 1; i >= 0; i--)
      stack.push({ raw: item.children[i], visibleParent: node ?? visibleParent, depth: depth + 1 });
  }
  let cursor = manager.getLeafId();
  let leafId: string | null = null;
  const visited = new Set<string>();
  while (cursor && !visited.has(cursor)) {
    visited.add(cursor);
    const entry = byId.get(cursor);
    if (!entry) break;
    if (entry.node) {
      entry.node.isActivePath = true;
      leafId ??= entry.node.id;
    }
    cursor = entry.parent;
  }
  const tree = { roots, leafId };
  if (Buffer.byteLength(JSON.stringify(tree)) > MAX_SNAPSHOT)
    throw new Error("Conversation tree is too large to display safely");
  return tree;
}
