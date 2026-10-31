import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { BoardScene } from "../../../packages/pi-live-chat/boardProtocol";
import {
  defaultPrimitiveProps,
  primitiveKinds,
} from "../../../packages/pi-live-chat/primitiveProtocol";
import { PrimitiveSvg } from "./Primitives";
import {
  exportFlowScene,
  importFlowScene,
  fromDiagram,
  replacementScene,
  toDiagram,
} from "./scene";

const scene: BoardScene = {
  engine: "react-flow",
  files: {},
  background: "#ffffff",
  elements: primitiveKinds.map((kind) => ({
    id: kind,
    type: "primitive",
    kind,
    x: 20,
    y: 40,
    width: 200,
    height: 120,
    version: 1,
    props: {
      ...defaultPrimitiveProps(),
      text: "Label",
      commands: [
        ["M", 0, 0],
        ["Q", 50, 100, 100, 0],
      ],
    },
  })),
};
it("round trips all primitives through editor state, backups, resizing, deletion and replacement", () => {
  expect(fromDiagram(toDiagram(scene), scene)).toEqual(scene);
  expect(importFlowScene(exportFlowScene(scene))).toEqual(scene);
  const view = toDiagram(scene);
  view.nodes[0]!.position.x = 100;
  view.nodes[0]!.width = 400;
  view.nodes = view.nodes.filter((n) => n.id !== "text");
  const changed = fromDiagram(view, scene);
  expect(changed.elements.find((e) => e.id === "line")).toMatchObject({
    x: 100,
    width: 400,
    version: 2,
  });
  expect(changed.elements.find((e) => e.id === "text")).toMatchObject({ isDeleted: true });
  const replacement = replacementScene(scene, scene);
  expect(replacement.elements.filter((e) => !e.isDeleted)).toHaveLength(5);
  expect(new Set(replacement.elements.map((e) => e.id)).size).toBe(10);
});
it("constructs only trusted SVG tags and escapes text instead of interpreting markup", () => {
  const drawing = {
    ...defaultPrimitiveProps(),
    text: '<script>alert(1)</script>\n<image href="https://evil.test"/>',
  };
  const svg = renderToStaticMarkup(<PrimitiveSvg shape="text" drawing={drawing} />);
  expect(svg).toContain("&lt;script&gt;");
  expect(svg).not.toContain("<script");
  expect(svg).not.toContain("<image");
  expect(svg).not.toContain("foreignObject");
  expect(svg).toContain("<tspan");
  for (const shape of primitiveKinds)
    expect(
      renderToStaticMarkup(<PrimitiveSvg shape={shape} drawing={defaultPrimitiveProps()} />),
    ).toContain("<svg");
});
