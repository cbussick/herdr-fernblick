import { describe, expect, it } from "vitest";
import type { BoardScene } from "../../../packages/pi-live-chat/boardProtocol";
import { validateFlowGraph } from "../../../packages/pi-live-chat/flowProtocol";
import { defaults, makeNode } from "./model";
import { makeInk } from "./ink";
import {
  exportFlowScene,
  fromDiagram,
  importFlowScene,
  replacementScene,
  toDiagram,
  validateScene,
} from "./scene";
const empty: BoardScene = { engine: "react-flow", elements: [], files: {}, background: "#ffffff" };
const card = () => makeNode("card", 10, 20, defaults("card"), "card");
describe("production flow scene boundary", () => {
  it("round trips six components, ink, parenting and connections without view state", () => {
    const group = makeNode("boundary", 0, 0, defaults("boundary"), "group");
    const nodes = [
      group,
      ...(["card", "icon", "detail", "table", "comment"] as const).map((kind) => ({
        ...makeNode(kind, 50, 60, defaults(kind), kind),
        parentId: "group",
        selected: true,
        measured: { width: 999, height: 999 },
      })),
      makeInk(
        "ink",
        [
          [0, 0, 0.5],
          [50, 10, 0.8],
        ],
        "#243044",
        5,
        true,
      ),
    ];
    const scene = fromDiagram(
      {
        nodes,
        edges: [
          {
            id: "edge",
            source: "card",
            target: "icon",
            sourceHandle: "right",
            targetHandle: "left",
            label: "calls",
          },
        ],
      },
      empty,
    );
    expect(validateFlowGraph(scene)).toHaveLength(8);
    expect(JSON.stringify(scene)).not.toMatch(/measured|selected|draggable/);
    expect(fromDiagram(toDiagram(scene), scene)).toEqual(scene);
  });
  it("bumps only genuine edits and keeps deletion tombstones, including removed edges", () => {
    const n = card();
    const base = fromDiagram(
      {
        nodes: [n, makeNode("icon", 20, 20, defaults("icon"), "icon")],
        edges: [{ id: "e", source: "card", target: "icon" }],
      },
      empty,
    );
    const view = toDiagram(base);
    view.nodes[0]!.selected = true;
    view.nodes[0]!.measured = { width: 800, height: 800 };
    expect(fromDiagram(view, base)).toEqual(base);
    view.nodes[0]!.position.x += 10;
    const moved = fromDiagram(view, base);
    expect(moved.elements.find((e) => e.id === "card")!.version).toBe(2);
    expect(moved.elements.find((e) => e.id === "icon")!.version).toBe(1);
    view.nodes = view.nodes.filter((n) => n.id !== "card");
    const removed = fromDiagram(view, moved);
    expect(removed.elements.find((e) => e.id === "card")).toMatchObject({
      isDeleted: true,
      version: 3,
    });
    expect(removed.elements.find((e) => e.id === "e")).toMatchObject({
      isDeleted: true,
      version: 2,
    });
    expect(fromDiagram(toDiagram(removed), removed)).toEqual(removed);
  });
  it("uses a bounded versioned backup with no authority", () => {
    const base = fromDiagram({ nodes: [card()], edges: [] }, empty);
    const raw = exportFlowScene({ ...base, grantId: "not-exported" } as BoardScene);
    expect(raw).not.toContain("grantId");
    expect(importFlowScene(raw)).toEqual(base);
    expect(() => importFlowScene(JSON.stringify(base))).toThrow();
    expect(() => importFlowScene(raw.replace('"version":1', '"version":2'))).toThrow();
    const replaced = replacementScene(base, base);
    expect(replaced.elements.find((e) => e.id === "card")!.isDeleted).toBe(true);
    expect(replaced.elements.filter((e) => !e.isDeleted)[0]!.id).not.toBe("card");
  });
  it("rejects other engines, dangling/cyclic graphs, SVG, URLs, malformed and oversized assets", () => {
    const base = fromDiagram({ nodes: [card()], edges: [] }, empty);
    expect(() => validateScene({ ...base, engine: "excalidraw" })).toThrow();
    expect(() =>
      validateScene({ ...base, elements: [{ ...base.elements[0], parentId: "missing" }] }),
    ).toThrow();
    expect(() =>
      validateScene({
        ...base,
        elements: [
          ...base.elements,
          {
            id: "x",
            type: "connection",
            source: "card",
            target: "missing",
            sourceHandle: "right",
            targetHandle: "left",
            x: 0,
            y: 0,
            width: 1,
            height: 1,
            version: 1,
            label: "",
            color: "#000000",
          },
        ],
      }),
    ).toThrow();
    for (const dataURL of [
      "https://example.com/a.png",
      "data:image/svg+xml;base64,PHN2Zz4=",
      "data:image/png;base64,A===",
      "data:image/png;base64," + "A".repeat(3 * 1024 * 1024),
    ])
      expect(() =>
        validateScene({
          ...base,
          files: { asset: { id: "asset", dataURL, mimeType: "image/png", created: 0 } },
        }),
      ).toThrow();
  });
  it("moves raster data to files and preserves referenced images and their identities", () => {
    const n = card();
    n.data.image =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9l8AAAAASUVORK5CYII=";
    const base = fromDiagram({ nodes: [n], edges: [] }, empty);
    expect(Object.keys(base.files)).toHaveLength(1);
    expect(base.elements[0]!.props).not.toHaveProperty("image");
    expect(fromDiagram(toDiagram(base), base)).toEqual(base);
  });
});
