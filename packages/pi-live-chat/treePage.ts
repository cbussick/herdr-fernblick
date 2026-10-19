import { createHash } from "node:crypto";
import type { ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";
import { contentText } from "./tree.js";
import {
  MAX_TREE_PAGE_BYTES,
  TREE_PAGE_SIZE,
  TREE_PREVIEW_LENGTH,
  treePageRequestSchema,
  type TreePage,
  type TreePageRequest,
  type TreePageRow,
} from "./treeProtocol.js";

type Manager = Pick<ExtensionContext["sessionManager"], "getEntries" | "getLeafId">;
type Visible = { row: TreePageRow; entry: SessionEntry; children: Visible[] };

// Index only references and small previews. Neither raw history nor a recursive
// tree crosses the wire. All ancestry walks are iterative and cycle-checked.
export function readTreePage(manager: Manager, input: TreePageRequest): TreePage {
  const request = treePageRequestSchema.parse(input);
  const entries = manager.getEntries();
  const rawLeaf = manager.getLeafId();
  const revision = createHash("sha256")
    .update(JSON.stringify([entries.length, entries.at(-1)?.id, rawLeaf]))
    .digest("hex");
  if (request.revision && request.revision !== revision)
    throw new Error("Conversation paths changed. Refresh paths to continue browsing.");
  const raw = new Map<string, { entry: SessionEntry; children: string[] }>();
  const labels = new Map<string, string>();
  for (const entry of entries) {
    if (raw.has(entry.id)) throw new Error("Conversation paths contain duplicate entries");
    raw.set(entry.id, { entry, children: [] });
    if (entry.type === "label") {
      if (entry.label) labels.set(entry.targetId, entry.label);
      else labels.delete(entry.targetId);
    }
  }
  const roots: string[] = [];
  for (const entry of entries) {
    const parent = entry.parentId ? raw.get(entry.parentId) : undefined;
    if (parent) parent.children.push(entry.id);
    else roots.push(entry.id);
  }
  const active = new Set<string>();
  let cursor = rawLeaf;
  while (cursor && raw.has(cursor)) {
    if (active.has(cursor)) throw new Error("Conversation paths contain cyclic ancestry");
    active.add(cursor);
    cursor = raw.get(cursor)!.entry.parentId;
  }
  const visible = new Map<string, Visible>();
  const visibleRoots: Visible[] = [];
  const stack = roots.map((id) => ({ id, parent: null as Visible | null })).reverse();
  const visited = new Set<string>();
  while (stack.length) {
    const { id, parent } = stack.pop()!;
    if (visited.has(id)) throw new Error("Conversation paths contain cyclic ancestry");
    visited.add(id);
    const { entry, children } = raw.get(id)!;
    let nextParent = parent;
    if (
      entry.type === "message" &&
      (entry.message.role === "user" || entry.message.role === "assistant")
    ) {
      const text = contentText(entry.message.content);
      if (entry.message.role === "user" || text.trim()) {
        const node: Visible = {
          entry,
          children: [],
          row: {
            id,
            parentId: parent?.row.id ?? null,
            role: entry.message.role,
            text: text.slice(0, TREE_PREVIEW_LENGTH),
            textTruncated: text.length > TREE_PREVIEW_LENGTH,
            timestamp: entry.timestamp?.slice(0, 64),
            label: labels.get(id)?.slice(0, 128),
            isActivePath: active.has(id),
            childCount: 0,
          },
        };
        visible.set(id, node);
        (parent?.children ?? visibleRoots).push(node);
        if (parent) parent.row.childCount++;
        nextParent = node;
      }
    }
    for (let i = children.length - 1; i >= 0; i--)
      stack.push({ id: children[i], parent: nextParent });
  }
  if (visited.size !== raw.size) throw new Error("Conversation paths contain cyclic ancestry");
  let leafId: string | null = null;
  for (const id of active)
    if (visible.has(id)) {
      leafId = id;
      break;
    }
  let mode: TreePage["mode"];
  let candidates: Visible[];
  let focusId: string | null = request.focusId ?? leafId;
  if (request.query || request.filter !== "all") {
    mode = "search";
    const query = request.query.toLocaleLowerCase();
    candidates = [...visible.values()].filter(
      ({ row, entry }) =>
        (request.filter === "all" ||
          (request.filter === "user" ? row.role === "user" : Boolean(row.label))) &&
        (!query ||
          labels.get(row.id)?.toLocaleLowerCase().includes(query) ||
          (entry.type === "message" &&
            "content" in entry.message &&
            contentText(entry.message.content).toLocaleLowerCase().includes(query))),
    );
  } else if (request.branchesOf !== undefined) {
    mode = "branches";
    const parent = request.branchesOf === null ? undefined : visible.get(request.branchesOf);
    if (request.branchesOf !== null && !parent)
      throw new Error("The selected fork is unavailable. Refresh paths.");
    candidates = parent?.children ?? visibleRoots;
    focusId = null;
  } else {
    mode = "path";
    if (request.focusId && !visible.has(request.focusId))
      throw new Error("The selected path is unavailable. Refresh paths.");
    const focus = focusId ? visible.get(focusId) : undefined;
    candidates = [];
    let ancestor = focus;
    while (ancestor) {
      candidates.push(ancestor);
      ancestor = ancestor.row.parentId ? visible.get(ancestor.row.parentId) : undefined;
    }
    candidates.reverse();
    // Follow a chosen alternative forward, preferring its active continuation,
    // otherwise its most recently appended continuation. Other paths stay explicit.
    let choices = focus ? (request.focusId ? focus.children : []) : visibleRoots;
    if (!focus) focusId = null;
    while (choices.length) {
      const next = choices.find((node) => node.row.isActivePath) ?? choices.at(-1)!;
      candidates.push(next);
      choices = next.children;
    }
  }
  const focusIndex = candidates.findIndex((node) => node.row.id === focusId);
  const offset =
    request.offset === undefined
      ? mode === "path"
        ? Math.max(0, (focusIndex < 0 ? candidates.length - 1 : focusIndex) - TREE_PAGE_SIZE + 1)
        : 0
      : Math.min(request.offset, Math.max(0, candidates.length - 1));
  const rows = candidates.slice(offset, offset + TREE_PAGE_SIZE).map((node) => node.row);
  const page: TreePage = {
    rows,
    leafId,
    focusId,
    mode,
    revision,
    total: candidates.length,
    rootCount: visibleRoots.length,
    offset,
    previousOffset: null,
    nextOffset: null,
  };
  // Reserve the largest cursor encoding so choosing backward/forward boundaries
  // cannot push an otherwise valid page over its byte budget.
  const headerBytes = Buffer.byteLength(
    JSON.stringify({
      ...page,
      rows: [],
      offset: Number.MAX_SAFE_INTEGER,
      previousOffset: Number.MAX_SAFE_INTEGER,
      nextOffset: Number.MAX_SAFE_INTEGER,
    }),
  );
  const rowBytes = (row: TreePageRow) => Buffer.byteLength(JSON.stringify(row));
  let bytes =
    headerBytes + rows.reduce((sum, row) => sum + rowBytes(row), 0) + Math.max(0, rows.length - 1);
  while (bytes > MAX_TREE_PAGE_BYTES && rows.length > 1) {
    const keepFocus =
      request.offset === undefined &&
      mode === "path" &&
      focusIndex - page.offset >= rows.length / 2;
    const removed = keepFocus ? rows.shift()! : rows.pop()!;
    if (keepFocus) page.offset++;
    bytes -= rowBytes(removed) + 1;
  }
  page.nextOffset =
    page.offset + rows.length < candidates.length ? page.offset + rows.length : null;
  // A fixed offset minus 50 skips history when previews require shorter pages.
  // Fit the preceding window backwards; reading it forwards must reach this one.
  let previousOffset = page.offset;
  bytes = headerBytes;
  for (let count = 0; previousOffset > 0 && count < TREE_PAGE_SIZE; count++) {
    const size = rowBytes(candidates[previousOffset - 1].row) + (count ? 1 : 0);
    if (bytes + size > MAX_TREE_PAGE_BYTES) break;
    bytes += size;
    previousOffset--;
  }
  page.previousOffset = page.offset > 0 ? previousOffset : null;
  return page;
}
