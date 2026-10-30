import { describe, expect, it } from "vitest";
import {
  applyInkCommand,
  gestureViewport,
  hitsInk,
  inkDimensions,
  makeInk,
  outline,
  validInk,
  type InkData,
} from "./ink";
import { defaults, makeNode, restore, serialize, type Diagram } from "./model";

const line = () =>
  makeInk(
    "stroke",
    [
      [100, 100, 0.4],
      [150, 100, 0.7],
      [200, 100, 0.6],
    ],
    "#243044",
    5,
    true,
  );
describe("freehand records and geometry", () => {
  it("normalizes a stroke without moving its original points in world space", () => {
    const node = line();
    expect(validInk(node.data)).toBe(true);
    expect(node.position.x + node.data.points[0]![0]).toBeCloseTo(100);
    expect(node.position.y + node.data.points[0]![1]).toBeCloseTo(100);
    expect(
      outline(node.data).every(
        (p) => p[0]! >= 0 && p[0]! <= node.data.w && p[1]! >= 0 && p[1]! <= node.data.h,
      ),
    ).toBe(true);
  });
  it("keeps a single click as a visible, selectable dot", () => {
    const dot = makeInk("dot", [[0, 0, 0.5]], "#243044", 5, false);
    expect(outline(dot.data).length).toBeGreaterThan(3);
    expect(dot.data.w).toBeGreaterThanOrEqual(8);
    expect(hitsInk(dot, [0, 0], [0, 0], 0)).toBe(true);
  });
  it("hits the rendered outline, not the whole stroke's bounding rectangle", () => {
    const node = makeInk(
      "angle",
      [
        [0, 0, 0.5],
        [100, 0, 0.5],
        [100, 100, 0.5],
      ],
      "#243044",
      4,
      false,
    );
    expect(hitsInk(node, [10, 80], [20, 80], 2)).toBe(false);
    expect(hitsInk(node, [50, -50], [50, 50], 2)).toBe(true);
  });
  it("eraser sweeps hit resized strokes and skip distant strokes", () => {
    const node = line();
    node.width = node.data.w * 2;
    node.height = node.data.h * 2;
    expect(inkDimensions(node).w).toBe(node.data.w * 2);
    expect(hitsInk(node, [180, 50], [180, 160], 2)).toBe(true);
    expect(hitsInk(node, [-100, -100], [-100, -50], 2)).toBe(false);
  });
  it("validates pressure, size, numeric bounds, and point limits", () => {
    const data = line().data;
    for (const patch of [
      { points: [] },
      { points: [[0, 0, -1]] },
      { points: [[0, Infinity, 0.5]] },
      { points: Array(10001).fill([0, 0, 0.5]) },
      { size: 50 },
      { w: 0 },
      { color: "url(external)" },
    ])
      expect(validInk({ ...data, ...patch })).toBe(false);
    expect(validInk({ ...data, pressure: false })).toBe(true);
  });
  it("round-trips ink dimensions without changing component props", () => {
    const ink = line();
    ink.width = 450;
    ink.height = 80;
    const board: Diagram = { nodes: [makeNode("card", 0, 0), ink], edges: [] };
    const roundtrip = restore(serialize(board));
    expect(roundtrip.nodes[0]!.data).toEqual(board.nodes[0]!.data);
    expect(roundtrip.nodes[1]!.data).toEqual(ink.data);
    expect(roundtrip.nodes[1]!.style).toEqual({ width: 450, height: 80 });
  });
  it("still reads version-one component canvases", () => {
    const raw = JSON.parse(serialize({ nodes: [makeNode("card", 0, 0)], edges: [] }));
    raw.version = 1;
    expect(restore(JSON.stringify(raw)).nodes).toHaveLength(1);
  });
  it("rejects grouped ink and connections to strokes", () => {
    const ink = line();
    ink.parentId = "group";
    expect(() =>
      restore(
        serialize({
          nodes: [makeNode("boundary", 0, 0, defaults("boundary"), "group"), ink],
          edges: [],
        }),
      ),
    ).toThrow();
    delete ink.parentId;
    expect(() =>
      restore(
        serialize({
          nodes: [makeNode("card", 0, 0, defaults("card"), "card"), ink],
          edges: [{ id: "bad", source: "card", target: "stroke" }],
        }),
      ),
    ).toThrow();
  });
  it("undo/redo touches only the strokes in its command", () => {
    const old = line();
    const moved = { ...old, position: { x: 400, y: 500 } };
    const card = makeNode("card", 0, 0);
    card.data.title = "Edited after drawing";
    const unrelated = makeInk("another", [[400, 400, 0.5]], "#243044", 5, false);
    const undone = applyInkCommand(
      [card, moved, unrelated],
      { before: [old], after: [moved] },
      true,
    );
    expect(undone.find((n) => n.id === "stroke")!.position).toEqual(old.position);
    expect(undone.find((n) => n.id === card.id)!.data).toEqual(card.data);
    expect(undone.find((n) => n.id === "another")).toEqual(unrelated);
    const redone = applyInkCommand(undone, { before: [old], after: [moved] }, false);
    expect(redone.find((n) => n.id === "stroke")!.position).toEqual(moved.position);
  });
  it("calculates midpoint-anchored two-finger zoom with bounded scale", () => {
    expect(
      gestureViewport(
        { x: 0, y: 0, zoom: 1 },
        { x: 100, y: 100 },
        { x: 200, y: 100 },
        { x: 50, y: 120 },
        { x: 250, y: 120 },
      ),
    ).toEqual({ x: -150, y: -80, zoom: 2 });
  });
  it("does not accept an arbitrary payload as a stroke", () => {
    expect(validInk({ kind: "ink" } as InkData)).toBe(false);
  });
});
