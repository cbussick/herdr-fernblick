import { describe, expect, it } from "vitest";
import type { BoardScene } from "../../../packages/pi-live-chat/boardProtocol";
import { BoardHistory } from "./history";
import { defaults, edgeOptions, makeNode, type Diagram } from "./model";
import { fromDiagram, toDiagram } from "./scene";

const empty: BoardScene = { engine: "react-flow", elements: [], files: {}, background: "#ffffff" };
function seed() {
  return fromDiagram(
    {
      nodes: [
        makeNode("card", 100, 100, defaults("card"), "a"),
        makeNode("comment", 500, 100, defaults("comment"), "b"),
      ],
      edges: [],
    },
    empty,
  );
}
function edit(scene: BoardScene, change: (diagram: Diagram) => void) {
  const diagram = toDiagram(scene);
  change(diagram);
  return fromDiagram(diagram, scene);
}
const move = (scene: BoardScene, id: string, x: number) =>
  edit(scene, (d) => {
    d.nodes.find((n) => n.id === id)!.position.x = x;
  });
const liveIds = (scene: BoardScene) =>
  scene.elements
    .filter((e) => !e.isDeleted)
    .map((e) => e.id)
    .sort();

describe("local board edit history", () => {
  it("restores an accidental move, preserves unrelated items, and increases versions on undo/redo", () => {
    const before = seed(),
      after = move(before, "a", 220),
      history = new BoardHistory();
    history.record(before, after);
    const restored = history.undo(after)!;
    expect(restored.elements.find((e) => e.id === "a")).toMatchObject({
      x: 100,
      y: 100,
      version: 3,
    });
    expect(restored.elements.find((e) => e.id === "b")).toEqual(
      before.elements.find((e) => e.id === "b"),
    );
    const redone = history.redo(restored)!;
    expect(redone.elements.find((e) => e.id === "a")).toMatchObject({ x: 220, version: 4 });
    expect(history.canRedo).toBe(false);
  });

  it("coalesces a complete drag/resize gesture, but keeps separate gestures separate", () => {
    const history = new BoardHistory(),
      group = Symbol(),
      first = seed();
    const next = move(first, "a", 140),
      last = move(next, "a", 200);
    history.record(first, next, group);
    history.record(next, last, group);
    const resized = edit(last, (d) => {
      d.nodes[0]!.width = 440;
    });
    history.record(last, resized, Symbol());
    const unresized = history.undo(resized)!;
    expect(unresized.elements.find((e) => e.id === "a")).toMatchObject({ x: 200, width: 300 });
    const unmoved = history.undo(unresized)!;
    expect(unmoved.elements.find((e) => e.id === "a")!.x).toBe(100);
    expect(history.canUndo).toBe(false);
    const movedAgain = history.redo(unmoved)!;
    expect(movedAgain.elements.find((e) => e.id === "a")!.x).toBe(200);
  });

  it("ignores selection, measurement, version-only changes and no-op gestures", () => {
    const history = new BoardHistory(),
      before = seed();
    const selected = edit(before, (d) => {
      d.nodes[0]!.selected = true;
      d.nodes[0]!.measured = { width: 999, height: 999 };
    });
    history.record(before, selected);
    const newer = structuredClone(selected);
    newer.elements[0]!.version = 200;
    history.record(selected, newer);
    expect(history.canUndo).toBe(false);
    const group = Symbol(),
      moved = move(before, "a", 200);
    history.record(before, moved, group);
    history.record(moved, before, group);
    expect(history.canUndo).toBe(false);
  });

  it("handles properties, additions, reparenting and connection edits in one ordered history", () => {
    const history = new BoardHistory(),
      first = seed();
    const added = edit(first, (d) => {
      d.nodes.unshift(makeNode("boundary", 0, 0, defaults("boundary"), "parent"));
    });
    history.record(first, added);
    const grouped = edit(added, (d) => {
      d.nodes.find((n) => n.id === "a")!.parentId = "parent";
    });
    history.record(added, grouped);
    const labeled = edit(grouped, (d) => {
      const n = d.nodes.find((n) => n.id === "a")!;
      if (n.type === "component") n.data.title = "My edit";
    });
    history.record(grouped, labeled);
    const connected = edit(labeled, (d) => {
      d.edges.push({
        ...edgeOptions,
        id: "edge",
        source: "a",
        target: "b",
        label: "My connection",
      });
    });
    history.record(labeled, connected);
    let current = connected;
    for (let i = 0; i < 4; i++) current = history.undo(current)!;
    expect(liveIds(current)).toEqual(["a", "b"]);
    expect(current.elements.find((e) => e.id === "a")).toMatchObject({
      parentId: null,
      props: { title: defaults("card").title },
    });
    for (let i = 0; i < 4; i++) current = history.redo(current)!;
    expect(liveIds(current)).toEqual(["a", "b", "edge", "parent"]);
    expect(current.elements.find((e) => e.id === "edge")).toMatchObject({ label: "My connection" });
  });

  it("restores a deleted subgraph atomically, including connection and boundary IDs", () => {
    const first = edit(seed(), (d) => {
      d.nodes.unshift(makeNode("boundary", 0, 0, defaults("boundary"), "parent"));
      d.nodes.find((n) => n.id === "a")!.parentId = "parent";
      d.edges.push({ ...edgeOptions, id: "edge", source: "a", target: "b" });
    });
    const deleted = fromDiagram({ nodes: [], edges: [] }, first),
      history = new BoardHistory();
    history.record(first, deleted);
    const restored = history.undo(deleted)!;
    expect(liveIds(restored)).toEqual(["a", "b", "edge", "parent"]);
    expect(restored.elements.find((e) => e.id === "a")).toMatchObject({ parentId: "parent" });
    expect(liveIds(history.redo(restored)!)).toEqual([]);
  });

  it("retains only the images required to undo an image deletion", () => {
    const image =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";
    const first = fromDiagram(
      { nodes: [makeNode("card", 0, 0, { ...defaults("card"), image }, "image")], edges: [] },
      empty,
    );
    const deleted = fromDiagram({ nodes: [], edges: [] }, first),
      history = new BoardHistory();
    expect(deleted.files).toEqual({});
    history.record(first, deleted);
    expect(history.undo(deleted)!.files).toEqual(first.files);
  });

  it("never records remote updates and preserves undo/redo across unrelated remote edits", () => {
    const history = new BoardHistory(),
      first = seed(),
      moved = move(first, "a", 200);
    history.record(first, moved);
    const remote = move(moved, "b", 700);
    history.reconcile(moved, remote);
    const undone = history.undo(remote)!;
    expect(undone.elements.find((e) => e.id === "a")!.x).toBe(100);
    expect(undone.elements.find((e) => e.id === "b")!.x).toBe(700);
    const remoteAgain = move(undone, "b", 800);
    history.reconcile(undone, remoteAgain);
    const redone = history.redo(remoteAgain)!;
    expect(redone.elements.find((e) => e.id === "a")!.x).toBe(200);
    expect(redone.elements.find((e) => e.id === "b")!.x).toBe(800);
    expect(history.canUndo).toBe(true);
    expect(history.undo(redone)!.elements.find((e) => e.id === "b")!.x).toBe(800);
    expect(history.canUndo).toBe(false);
  });

  it("invalidates conflicting transactions and refuses stale or graph-breaking restores without moving the stacks", () => {
    const history = new BoardHistory(),
      first = seed(),
      moved = move(first, "a", 200);
    history.record(first, moved);
    const conflicting = move(moved, "a", 300);
    expect(() => history.undo(conflicting)).toThrow("Newer changes were preserved");
    expect(history.canUndo).toBe(true);
    history.reconcile(moved, conflicting);
    expect(history.canUndo).toBe(false);
    const created = fromDiagram(
      { nodes: [makeNode("card", 0, 0, defaults("card"), "new")], edges: [] },
      empty,
    );
    history.record(empty, created);
    const remote = edit(created, (d) => {
      d.nodes.push(makeNode("card", 500, 0, defaults("card"), "remote"));
      d.edges.push({ ...edgeOptions, id: "remote-edge", source: "new", target: "remote" });
    });
    history.reconcile(created, remote);
    expect(() => history.undo(remote)).toThrow();
    expect(history.canUndo).toBe(true);
  });

  it("discards redo after a new edit, honors lock rejection, and bounds memory and entry count", () => {
    const history = new BoardHistory(2),
      first = seed(),
      a = move(first, "a", 200),
      b = move(a, "a", 300),
      c = move(b, "a", 400);
    history.record(first, a);
    history.record(a, b);
    history.record(b, c);
    expect(history.undo(c, () => false)).toBeUndefined();
    expect(history.canUndo).toBe(true);
    const once = history.undo(c)!,
      twice = history.undo(once)!;
    expect(twice.elements.find((e) => e.id === "a")!.x).toBe(200);
    expect(history.canUndo).toBe(false);
    const fresh = move(twice, "a", 500);
    history.record(twice, fresh);
    expect(history.canRedo).toBe(false);
    const small = new BoardHistory(50, 1);
    small.record(first, a);
    expect(small.canUndo).toBe(false);
  });
});
