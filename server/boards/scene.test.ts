import { expect, it } from "vitest";
import { applyOperations, emptyScene, validateScene } from "./scene.js";

it.each([undefined, "excalidraw"])("rejects legacy engine %s, including empty scenes", (engine) => {
  expect(() => validateScene({ elements: [], files: {}, background: "#ffffff", engine })).toThrow();
});
it("rejects native elements even when labeled as a flow board", () => {
  expect(() =>
    validateScene({
      ...emptyScene(),
      elements: [{ id: "old", type: "rectangle", x: 0, y: 0, width: 100, height: 60 }],
    }),
  ).toThrow();
});
it("creates only structured boards and preserves unrelated shapes", () => {
  const scene = applyOperations(emptyScene(), [
    { op: "create", id: "old", kind: "card", x: 0, y: 0 },
  ]);
  const next = applyOperations(scene, [{ op: "create", id: "box", kind: "rectangle", x: 0, y: 0 }]);
  expect(next.engine).toBe("react-flow");
  expect(next.elements[0]).toEqual(scene.elements[0]);
  expect(next.elements[1]).toMatchObject({ type: "primitive", kind: "rectangle" });
  expect(scene.elements).toHaveLength(1);
});
