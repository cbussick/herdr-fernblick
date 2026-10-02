import {
  MAX_BOARD_BYTES,
  boardSceneSchema,
  type BoardElement,
  type BoardScene,
} from "../../../packages/pi-live-chat/boardProtocol";

export function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, child: unknown) => {
    if (!child || typeof child !== "object" || Array.isArray(child)) return child;
    const object = child as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(object)
        .sort()
        .map((key) => [key, object[key]]),
    );
  });
}
const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);
const removed = (base: BoardElement | undefined, value: BoardElement | undefined) =>
  !!value?.isDeleted || (!!base && !value);
function tombstone(element: BoardElement): BoardElement {
  return { ...element, isDeleted: true };
}
function references(element: BoardElement): string[] {
  const result: string[] = [];
  for (const key of ["frameId", "containerId"]) {
    if (typeof element[key] === "string") result.push(element[key]);
  }
  for (const key of ["startBinding", "endBinding"]) {
    const binding = element[key];
    if (
      binding &&
      typeof binding === "object" &&
      !Array.isArray(binding) &&
      typeof binding.elementId === "string"
    )
      result.push(binding.elementId);
  }
  if (Array.isArray(element.boundElements)) {
    for (const bound of element.boundElements) {
      if (
        bound &&
        typeof bound === "object" &&
        !Array.isArray(bound) &&
        typeof bound.id === "string"
      )
        result.push(bound.id);
    }
  }
  return result;
}

/** Local wins competing edits; deletions win. No field-wise native-record mixing. */
export function mergeScene(base: BoardScene, local: BoardScene, remote: BoardScene): BoardScene {
  const b = new Map(base.elements.map((e) => [e.id, e]));
  const l = new Map(local.elements.map((e) => [e.id, e]));
  const r = new Map(remote.elements.map((e) => [e.id, e]));
  const chosen = new Map<string, BoardElement>();
  for (const id of new Set([...b.keys(), ...l.keys(), ...r.keys()])) {
    const before = b.get(id),
      mine = l.get(id),
      theirs = r.get(id);
    if (!before && mine && theirs && !same(mine, theirs))
      throw new Error("Concurrent shape ID collision; your drawing is retained");
    let winner: BoardElement | undefined;
    if (
      (removed(before, mine) && !same(before, mine)) ||
      (removed(before, theirs) && !same(before, theirs))
    ) {
      winner = tombstone(mine ?? theirs ?? before!);
    } else {
      winner = same(before, mine) ? theirs : mine;
    }
    if (winner) chosen.set(id, structuredClone(winner));
  }

  // Server array order is authoritative unless the human actually reordered
  // existing shapes. Insert independent local additions next to their local
  // predecessor. restoreElements repairs native indices to this array order.
  const common = base.elements.map((e) => e.id).filter((id) => l.has(id) && r.has(id));
  const projected = (s: BoardScene) =>
    s.elements.map((e) => e.id).filter((id) => common.includes(id));
  const reordered = !same(projected(base), projected(local));
  let order = (reordered ? local : remote).elements.map((e) => e.id);
  for (const e of (reordered ? remote : local).elements) {
    if (order.includes(e.id)) continue;
    const source = (reordered ? remote : local).elements;
    const at = source.findIndex((item) => item.id === e.id);
    const previous = source
      .slice(0, at)
      .reverse()
      .find((item) => order.includes(item.id));
    order.splice(previous ? order.indexOf(previous.id) + 1 : order.length, 0, e.id);
  }
  for (const id of chosen.keys()) if (!order.includes(id)) order.push(id);
  const elements = order.flatMap((id) => (chosen.has(id) ? [chosen.get(id)!] : []));

  // Never publish dangling native relations. Preserve whole dependency sets;
  // incompatible simultaneous binding/frame edits use explicit recovery.
  for (const element of elements.filter((e) => !e.isDeleted)) {
    for (const id of references(element)) {
      const target = chosen.get(id);
      if (!target || target.isDeleted)
        throw new Error("Concurrent binding/frame change needs recovery; your drawing is retained");
      const sources = [local, remote].filter((s) =>
        same(
          s.elements.find((e) => e.id === element.id),
          element,
        ),
      );
      if (sources.length === 1) {
        const sourceTarget = sources[0].elements.find((e) => e.id === id);
        if (!same(sourceTarget, target) && !same(b.get(id), sourceTarget))
          throw new Error(
            "Concurrent related-shape change needs recovery; your drawing is retained",
          );
      }
    }
  }
  const files: BoardScene["files"] = {};
  const used = new Set(elements.filter((e) => e.type === "image").map((e) => e.fileId));
  for (const id of used) {
    if (typeof id !== "string") continue;
    const mine = local.files[id],
      theirs = remote.files[id];
    if (mine && theirs && (mine.mimeType !== theirs.mimeType || mine.dataURL !== theirs.dataURL))
      throw new Error("Concurrent image asset conflict; your drawing is retained");
    const file = mine ?? theirs ?? base.files[id];
    if (!file) throw new Error("Missing image asset; your drawing is retained");
    files[id] = structuredClone(file);
  }
  const scene = boardSceneSchema.parse({
    elements,
    files,
    background: local.background !== base.background ? local.background : remote.background,
  });
  if (new TextEncoder().encode(JSON.stringify(scene)).byteLength > MAX_BOARD_BYTES)
    throw new Error("Merged board exceeds 12 MiB; your drawing is retained");
  return scene;
}

/** Strip restoration-only changes from untouched records at the editor boundary. */
export function editorChanges(raw: BoardScene, baseline: BoardScene, next: BoardScene): BoardScene {
  const original = new Map(raw.elements.map((e) => [e.id, e]));
  const restored = new Map(baseline.elements.map((e) => [e.id, e]));
  return {
    ...next,
    elements: next.elements.map((e) => {
      const previous = restored.get(e.id);
      const native = original.get(e.id);
      return native && same(previous, e) ? native : e;
    }),
  };
}
