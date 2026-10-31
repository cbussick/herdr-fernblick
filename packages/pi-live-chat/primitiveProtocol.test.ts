import { expect, it } from "vitest";
import {
  defaultPrimitiveProps,
  primitiveKinds,
  primitivePropsSchema,
} from "./primitiveProtocol.js";
import { validateFlowGraph } from "./flowProtocol.js";
import { boardRequestSchema } from "./boardProtocol.js";

it("bounds the five data-only SVG primitive kinds and path grammar", () => {
  expect(primitiveKinds).toEqual(["line", "rectangle", "ellipse", "path", "text"]);
  expect(primitivePropsSchema.parse(defaultPrimitiveProps())).toEqual(defaultPrimitiveProps());
  for (const extra of [
    { svg: "<svg/>" },
    { d: "M0 0" },
    { href: "https://evil.test" },
    { onload: "alert(1)" },
    { style: { fill: "url(https://evil.test)" } },
  ])
    expect(primitivePropsSchema.safeParse({ ...defaultPrimitiveProps(), ...extra }).success).toBe(
      false,
    );
  for (const commands of [
    [["L", 0, 0]],
    [["M", -1, 0]],
    [["M", 101, 0]],
    [["M", NaN, 0]],
    [
      ["M", 0, 0],
      ["A", 1, 2],
    ],
    Array.from({ length: 501 }, () => ["M", 0, 0]),
  ])
    expect(primitivePropsSchema.safeParse({ ...defaultPrimitiveProps(), commands }).success).toBe(
      false,
    );
  expect(
    primitivePropsSchema.safeParse({ ...defaultPrimitiveProps(), fill: "url(#x)" }).success,
  ).toBe(false);
  expect(
    primitivePropsSchema.safeParse({ ...defaultPrimitiveProps(), text: "\n".repeat(20) }).success,
  ).toBe(false);
  const elements = Array.from({ length: 70 }, (_, i) => ({
    id: `p${i}`,
    type: "primitive",
    kind: "path",
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    version: 1,
    props: {
      ...defaultPrimitiveProps(),
      commands: [["M", 0, 0], ...Array.from({ length: 499 }, () => ["C", 1, 2, 3, 4, 5, 6])],
    },
  }));
  expect(() => validateFlowGraph({ elements, files: {} })).toThrow("limits");
});
it("exposes drawing props without accepting raw SVG in the public operation schema", () => {
  const request = {
    type: "board-request",
    id: "00000000-0000-4000-8000-000000000001",
    target: {
      runtime: "00000000-0000-4000-8000-000000000002",
      epoch: "00000000-0000-4000-8000-000000000003",
      sessionId: "s",
    },
    grantId: "00000000-0000-4000-8000-000000000004",
    boardId: "a".repeat(64),
    action: "apply",
    operations: [
      {
        op: "create",
        id: "p",
        kind: "path",
        x: 0,
        y: 0,
        drawing: {
          commands: [
            ["M", 0, 0],
            ["Q", 50, 100, 100, 0],
          ],
        },
      },
    ],
  };
  expect(boardRequestSchema.safeParse(request).success).toBe(true);
  expect(
    boardRequestSchema.safeParse({
      ...request,
      operations: [{ ...request.operations[0], drawing: { svg: "<svg/>" } }],
    }).success,
  ).toBe(false);
});
