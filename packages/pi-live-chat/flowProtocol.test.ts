import { expect, it } from "vitest";
import { boardRequestSchema, boardSceneSchema } from "./boardProtocol.js";
import { defaultFlowProps, flowKinds, validateFlowGraph } from "./flowProtocol.js";

const card = (id: string) => ({
  id,
  type: "component" as const,
  kind: "card" as const,
  x: 0,
  y: 0,
  width: 300,
  height: 180,
  version: 1,
  parentId: null,
  props: defaultFlowProps("card"),
});
it.each(flowKinds)("validates bounded default props for %s", (kind) => {
  expect(
    validateFlowGraph({
      elements: [{ ...card("node"), kind, props: defaultFlowProps(kind) }],
      files: {},
    }),
  ).toHaveLength(1);
});
it("leaves the legacy scene shape intact and accepts an explicit flow engine", () => {
  const legacy = { elements: [], files: {}, background: "#ffffff" };
  expect(boardSceneSchema.parse(legacy)).toEqual(legacy);
  expect(boardSceneSchema.parse({ ...legacy, engine: "react-flow" }).engine).toBe("react-flow");
});
it("rejects arbitrary markup/URLs as rendering properties instead of accepting custom code", () => {
  for (const props of [
    { ...defaultFlowProps("card"), html: "<script>unsafe</script>" },
    { ...defaultFlowProps("card"), imageId: "https://example.org/image.png" },
    { ...defaultFlowProps("card"), color: "url(external)" },
  ])
    expect(() => validateFlowGraph({ elements: [{ ...card("a"), props }], files: {} })).toThrow();
});
it("rejects dangling references, boundary cycles and mismatched table rows", () => {
  expect(() =>
    validateFlowGraph({ elements: [{ ...card("a"), parentId: "missing" }], files: {} }),
  ).toThrow("boundary");
  expect(() =>
    validateFlowGraph({ elements: [{ ...card("a"), kind: "boundary", parentId: "a" }], files: {} }),
  ).toThrow("boundary");
  expect(() =>
    validateFlowGraph({
      elements: [{ ...card("a"), props: { ...defaultFlowProps("table"), rows: [["only one"]] } }],
      files: {},
    }),
  ).toThrow("row/column");
  expect(() =>
    validateFlowGraph({
      elements: [{ ...card("a"), props: { ...defaultFlowProps("card"), imageId: "missing" } }],
      files: {},
    }),
  ).toThrow("asset");
});
it("requires unique IDs and caps live elements", () => {
  expect(() => validateFlowGraph({ elements: [card("a"), card("a")], files: {} })).toThrow(
    "Duplicate",
  );
  expect(() =>
    validateFlowGraph({
      elements: Array.from({ length: 301 }, (_, i) => card(`node-${i}`)),
      files: {},
    }),
  ).toThrow("limits");
});
it("accepts typed component operations but rejects scripts and unknown props", () => {
  const request = {
    type: "board-request",
    id: "00000000-0000-4000-8000-000000000001",
    target: {
      runtime: "00000000-0000-4000-8000-000000000002",
      epoch: "00000000-0000-4000-8000-000000000003",
      sessionId: "session",
    },
    grantId: "00000000-0000-4000-8000-000000000004",
    boardId: "a".repeat(64),
    action: "apply",
    operations: [{ op: "create", id: "card", kind: "card", x: 0, y: 0, props: { title: "Hello" } }],
  };
  expect(boardRequestSchema.safeParse(request).success).toBe(true);
  expect(
    boardRequestSchema.safeParse({
      ...request,
      operations: [{ ...request.operations[0], props: { script: "unsafe()" } }],
    }).success,
  ).toBe(false);
});
