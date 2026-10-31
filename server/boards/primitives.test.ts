import { expect, it } from "vitest";
import type { BoardOperation, BoardScene } from "../../packages/pi-live-chat/boardProtocol.js";
import { primitiveKinds } from "../../packages/pi-live-chat/primitiveProtocol.js";
import { applyOperations, emptyScene, summarize, validateScene } from "./scene.js";

it("creates, reads, edits, transforms and deletes SVG primitives without losing components/ink", () => {
  let scene = emptyScene("react-flow");
  scene = applyOperations(scene, [
    { op: "create", id: "card", kind: "card", x: 0, y: 0 },
    ...primitiveKinds.map(
      (kind): BoardOperation => ({
        op: "create",
        id: kind,
        kind,
        x: 50,
        y: 100,
        width: 200,
        height: 150,
        drawing: {
          text: "<script>literal text</script>",
          commands: [["M", 0, 0], ["C", 20, 100, 80, 0, 100, 100], ["Z"]],
        },
      }),
    ),
  ]);
  expect(scene.elements).toHaveLength(6);
  expect(summarize(scene, 1).elements.find((e) => e.id === "path")).toMatchObject({
    type: "primitive",
    kind: "path",
    drawing: { commands: [["M", 0, 0], ["C", 20, 100, 80, 0, 100, 100], ["Z"]] },
  });
  const next = applyOperations(scene, [
    {
      op: "update",
      id: "ellipse",
      x: 75,
      width: 400,
      color: "#112233",
      drawing: { fill: "#abcdef" },
    },
    { op: "delete", id: "path" },
  ]);
  expect(next.elements.find((e) => e.id === "ellipse")).toMatchObject({
    x: 75,
    width: 400,
    version: 2,
    props: { stroke: "#112233", fill: "#abcdef" },
  });
  expect(next.elements.find((e) => e.id === "path")).toMatchObject({ isDeleted: true, version: 2 });
  expect(next.elements[0]).toEqual(scene.elements[0]);
  expect(scene.elements.find((e) => e.id === "ellipse")!.width).toBe(200);
});
it("fails closed for cross-engine primitives and incompatible props/relationships", () => {
  const primitive = {
    op: "create" as const,
    id: "p",
    kind: "rectangle" as const,
    x: 0,
    y: 0,
    drawing: { fill: "#123456" },
  };
  expect(() => applyOperations(emptyScene(), [primitive])).toThrow();
  const scene = applyOperations(emptyScene("react-flow"), [primitive]);
  expect(() => validateScene({ ...scene, engine: "excalidraw" })).toThrow();
  for (const operation of [
    { op: "update", id: "p", props: { title: "not a component" } },
    { op: "update", id: "p", parentId: null },
    { op: "update", id: "p", text: "use drawing.text" },
    { op: "create", id: "card", kind: "card", x: 0, y: 0, drawing: { text: "wrong type" } },
  ])
    expect(() => applyOperations(scene, [operation as BoardOperation])).toThrow();
  expect(() =>
    validateScene({
      ...scene,
      elements: [{ ...scene.elements[0], props: { svg: "<svg/>" } }],
    } as BoardScene),
  ).toThrow();
});
