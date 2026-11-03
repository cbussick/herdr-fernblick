import { useRef, useState } from "react";
import type { BoardElement, BoardScene } from "../../../packages/pi-live-chat/boardProtocol";
import { validateScene } from "./scene";

type Change = { id: string; before: BoardElement | null; after: BoardElement | null };
type Command = { changes: Change[]; files: BoardScene["files"]; group?: symbol; bytes: number };
const canonical = (value: unknown): string =>
  JSON.stringify(value, (_key, item: unknown) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
      : item,
  );
function live(element?: BoardElement): BoardElement | null {
  return element && !element.isDeleted ? element : null;
}
function fingerprint(element: BoardElement | null | undefined): string {
  if (!live(element ?? undefined)) return "null";
  const { version: _version, isDeleted: _deleted, ...content } = element!;
  return canonical(content);
}
function changesBetween(before: BoardScene, after: BoardScene): Change[] {
  const old = new Map(before.elements.map((e) => [e.id, e]));
  const next = new Map(after.elements.map((e) => [e.id, e]));
  return [...new Set([...old.keys(), ...next.keys()])].flatMap((id) => {
    const before = live(old.get(id)),
      after = live(next.get(id));
    return fingerprint(before) === fingerprint(after) ? [] : [{ id, before, after }];
  });
}
function imageIds(changes: Change[]): Set<string> {
  const ids = new Set<string>();
  for (const change of changes)
    for (const element of [change.before, change.after]) {
      if (element?.type !== "component") continue;
      const props = element.props;
      if (
        props &&
        typeof props === "object" &&
        !Array.isArray(props) &&
        typeof props.imageId === "string"
      )
        ids.add(props.imageId);
    }
  return ids;
}

/** Local edits only. Commands touch explicit IDs, retain tombstones/assets, and
 * are never whole-board snapshots that could overwrite another author's work. */
export class BoardHistory {
  private past: Command[] = [];
  private future: Command[] = [];
  private readonly maxEntries: number;
  private readonly maxBytes: number;
  constructor(maxEntries = 50, maxBytes = 32 * 1024 * 1024) {
    this.maxEntries = maxEntries;
    this.maxBytes = maxBytes;
  }
  get canUndo() {
    return this.past.length > 0;
  }
  get canRedo() {
    return this.future.length > 0;
  }
  clear() {
    this.past = [];
    this.future = [];
  }

  record(before: BoardScene, after: BoardScene, group?: symbol): boolean {
    let changes = changesBetween(before, after);
    if (!changes.length) return false;
    let files = { ...before.files, ...after.files };
    const previous = this.past.at(-1);
    if (group !== undefined && previous?.group === group) {
      this.past.pop();
      const merged = new Map(previous.changes.map((change) => [change.id, change]));
      for (const change of changes) {
        const first = merged.get(change.id);
        merged.set(change.id, first ? { ...change, before: first.before } : change);
      }
      changes = [...merged.values()].filter((c) => fingerprint(c.before) !== fingerprint(c.after));
      files = { ...previous.files, ...files };
    }
    this.future = [];
    if (changes.length) {
      const needed = imageIds(changes);
      const retained = Object.fromEntries(Object.entries(files).filter(([id]) => needed.has(id)));
      const detached = structuredClone({ changes, files: retained });
      const bytes = new TextEncoder().encode(JSON.stringify(detached)).length;
      this.past.push({ ...detached, group, bytes });
    }
    let bytes = this.past.reduce((sum, command) => sum + command.bytes, 0);
    while (this.past.length > this.maxEntries || bytes > this.maxBytes) {
      bytes -= this.past.shift()!.bytes;
    }
    return true;
  }

  /** Incoming changes are not undo steps. Drop an entire local transaction when
   * another author changed one of its records; unrelated local history survives. */
  reconcile(before: BoardScene, after: BoardScene): boolean {
    const changed = new Set(changesBetween(before, after).map((c) => c.id));
    const changedFiles = new Set(
      Object.keys(before.files).filter(
        (id) => after.files[id] && canonical(before.files[id]) !== canonical(after.files[id]),
      ),
    );
    const keep = (command: Command) =>
      !command.changes.some((c) => changed.has(c.id)) &&
      !Object.keys(command.files).some((id) => changedFiles.has(id));
    const old = this.past.length + this.future.length;
    this.past = this.past.filter(keep);
    this.future = this.future.filter(keep);
    return old !== this.past.length + this.future.length;
  }

  undo(scene: BoardScene, accept: (next: BoardScene) => boolean = () => true) {
    return this.restore(scene, true, accept);
  }
  redo(scene: BoardScene, accept: (next: BoardScene) => boolean = () => true) {
    return this.restore(scene, false, accept);
  }
  private restore(scene: BoardScene, undo: boolean, accept: (next: BoardScene) => boolean) {
    const source = undo ? this.past : this.future;
    const destination = undo ? this.future : this.past;
    const command = source.at(-1);
    if (!command) return;
    const elements = new Map(scene.elements.map((e) => [e.id, e]));
    for (const change of command.changes) {
      const current = elements.get(change.id);
      const expected = undo ? change.after : change.before;
      if (fingerprint(current) !== fingerprint(expected))
        throw new Error(
          "Cannot undo/redo: an affected item has changed. Newer changes were preserved.",
        );
      const wanted = undo ? change.before : change.after;
      const version = Number(current?.version ?? 0) + 1;
      if (wanted)
        elements.set(change.id, { ...structuredClone(wanted), version, isDeleted: false });
      else if (current) elements.set(change.id, { ...current, version, isDeleted: true });
    }
    const files = { ...scene.files };
    for (const [id, file] of Object.entries(command.files)) {
      if (files[id] && files[id].dataURL !== file.dataURL)
        throw new Error("Cannot undo/redo: an image asset has changed.");
      files[id] = file;
    }
    const used = imageIds(
      [...elements.values()]
        .filter((e) => !e.isDeleted)
        .map((after) => ({ id: after.id, before: null, after })),
    );
    // Validate the complete graph before changing either stack or publishing.
    // This also prevents removing an item now referenced by an agent's new edge.
    const next = validateScene({
      ...scene,
      elements: [...elements.values()],
      files: Object.fromEntries(Object.entries(files).filter(([id]) => used.has(id))),
    });
    if (!accept(next)) return;
    source.pop();
    destination.push(command);
    return next;
  }
}

export function useBoardHistory(
  current: () => BoardScene,
  publish: (scene: BoardScene) => boolean,
  problem: (message: string) => void,
) {
  const store = useRef(new BoardHistory());
  const [availability, setAvailability] = useState({ canUndo: false, canRedo: false });
  const refresh = () =>
    setAvailability({ canUndo: store.current.canUndo, canRedo: store.current.canRedo });
  const restore = (undo: boolean) => {
    try {
      const next = undo
        ? store.current.undo(current(), publish)
        : store.current.redo(current(), publish);
      if (next) refresh();
    } catch (error) {
      problem(error instanceof Error ? error.message : "Cannot undo/redo this edit.");
    }
  };
  return {
    record: (before: BoardScene, after: BoardScene, group?: symbol) => {
      if (store.current.record(before, after, group)) refresh();
    },
    reconcile: (before: BoardScene, after: BoardScene) => {
      if (store.current.reconcile(before, after)) {
        refresh();
        problem("Undo/redo for items changed elsewhere has been cleared.");
      }
    },
    clear: () => {
      store.current.clear();
      refresh();
    },
    undo: () => restore(true),
    redo: () => restore(false),
    ...availability,
  };
}
