import { expect, it } from "vitest";
import { applyOperations, emptyScene } from "./scene.js";

it("uses clean drawing defaults for agent-created shapes without restyling existing ones", () => {
  const existing = {
    id: "old",
    type: "rectangle" as const,
    x: 0,
    y: 0,
    width: 100,
    height: 60,
    roughness: 2,
  };
  const scene = { ...emptyScene(), elements: [existing] };
  const next = applyOperations(scene, [
    { op: "create", id: "box", kind: "rectangle", x: 0, y: 0 },
    { op: "create", id: "label", kind: "text", x: 0, y: 0, text: "Hello" },
    { op: "create", id: "arrow", kind: "arrow", x: 0, y: 0, endX: 100, endY: 0 },
  ]);
  expect(next.elements[0]).toEqual(existing);
  expect(next.elements.slice(1).map((element) => element.roughness)).toEqual([0, 0, 0]);
  expect(next.elements[2]).toMatchObject({ fontFamily: 6 });
  expect(next.elements[3]).toMatchObject({ startArrowhead: null, endArrowhead: "triangle" });
  expect(scene.elements).toEqual([existing]);
});
