import { describe, expect, it } from "vitest";
import type { BoardOperation, BoardScene } from "../../packages/pi-live-chat/boardProtocol.js";
import { defaultFlowProps } from "../../packages/pi-live-chat/flowProtocol.js";
import { applyOperations, emptyScene, summarize, validateScene } from "./scene.js";
import { flowDependencies } from "./flowScene.js";

const create = (
  id: string,
  kind: "card" | "boundary" = "card",
): Extract<BoardOperation, { op: "create" }> => ({
  op: "create",
  id,
  kind,
  x: 10,
  y: 20,
});
const fixture = () =>
  applyOperations(emptyScene("react-flow"), [
    create("boundary", "boundary"),
    { ...create("child"), parentId: "boundary" },
    create("other"),
    { op: "create", id: "edge", kind: "connection", x: 0, y: 0, source: "child", target: "other" },
  ]);

describe("flow scene boundary", () => {
  it("creates typed defaults, merges props and edits geometry, parents and endpoints", () => {
    const scene = fixture();
    expect(scene.elements[1]).toMatchObject({
      type: "component",
      kind: "card",
      parentId: "boundary",
      version: 1,
      props: defaultFlowProps("card"),
    });
    const next = applyOperations(scene, [
      {
        op: "update",
        id: "child",
        props: { title: "https://plain-title", body: "data:text is just text" },
        parentId: null,
        x: 90,
        width: 300,
        color: "#123456",
      },
      {
        op: "update",
        id: "edge",
        source: "boundary",
        sourceHandle: "bottom",
        label: "uses",
        color: "#654321",
      },
    ]);
    expect(next.elements[1]).toMatchObject({
      x: 90,
      width: 300,
      parentId: null,
      version: 2,
      props: {
        title: "https://plain-title",
        body: "data:text is just text",
        color: "#123456",
        subtitle: "",
      },
    });
    expect(next.elements[3]).toMatchObject({
      source: "boundary",
      sourceHandle: "bottom",
      label: "uses",
    });
    expect(scene.elements[1].version).toBe(1);
  });

  it("rejects dangling relations, nesting and mixed-engine elements/fields", () => {
    const scene = fixture();
    for (const ops of [
      [{ op: "delete", id: "boundary" }],
      [{ op: "delete", id: "child" }],
      [{ op: "update", id: "boundary", parentId: "other" }],
      [{ op: "update", id: "edge", target: "missing" }],
      [{ op: "update", id: "edge", target: "child" }],
      [{ op: "update", id: "child", props: { imageId: "missing" } }],
      [{ op: "update", id: "child", text: "not native" }],
      [{ op: "update", id: "edge", props: { title: "not component" } }],
    ] as BoardOperation[][])
      expect(() => applyOperations(scene, ops)).toThrow();
    expect(() => validateScene({ ...scene, engine: undefined })).toThrow();
    expect(() => applyOperations(emptyScene(), [create("a")])).toThrow();
    expect(() =>
      applyOperations(emptyScene(), [
        { op: "create", id: "a", kind: "rectangle", x: 0, y: 0, parentId: null },
      ]),
    ).toThrow();
    expect(() =>
      validateScene({
        ...scene,
        elements: [{ ...scene.elements[0], props: { ...defaultFlowProps("card"), css: "bad" } }],
      }),
    ).toThrow();
    expect(() =>
      validateScene({ ...scene, elements: [{ ...scene.elements[0], version: 0 }] }),
    ).toThrow();
  });

  it("reports invalid final candidates as client errors rather than server failures", () => {
    try {
      applyOperations(fixture(), [{ op: "delete", id: "child" }]);
      expect.unreachable("Dangling edge must fail");
    } catch (error) {
      expect(error).toMatchObject({ status: 400 });
    }
  });

  it("keeps even maximally JSON-escaped component summaries pageable", () => {
    const control = "\u0001".repeat(4000);
    const props = {
      ...defaultFlowProps("table"),
      title: control,
      subtitle: control,
      body: control,
      fields: Array.from({ length: 20 }, () => ({
        label: control,
        value: control,
        color: "",
        type: "text" as const,
      })),
      columns: Array.from({ length: 20 }, () => control.slice(0, 256)),
      rows: Array.from({ length: 20 }, () => Array.from({ length: 20 }, () => control)),
    };
    const scene = applyOperations(emptyScene("react-flow"), [
      { ...create("large"), props },
      create("next"),
    ]);
    const summary = summarize(scene, 1);
    expect(summary.elements[0].id).toBe("large");
    expect(Buffer.byteLength(JSON.stringify(summary))).toBeLessThan(128 * 1024 + 1024);
  });

  it("returns full ordinary table props so agents need not reconstruct truncated rows", () => {
    const props = {
      ...defaultFlowProps("table"),
      title: "A full readable table",
      rows: Array.from({ length: 25 }, (_, i) => [
        String(i),
        "Existing value that must survive edits",
      ]),
    };
    const scene = applyOperations(emptyScene("react-flow"), [
      { ...create("table"), kind: "table", props },
    ]);
    expect(summarize(scene, 1).elements[0]).toMatchObject({ props, propsTruncated: false });
  });

  it("permits explicit related deletions in either order and reparent-before-delete", () => {
    const scene = fixture();
    expect(
      applyOperations(scene, [
        { op: "delete", id: "boundary" },
        { op: "delete", id: "child" },
        { op: "delete", id: "edge" },
      ])
        .elements.filter((e) => !e.isDeleted)
        .map((e) => e.id),
    ).toEqual(["other"]);
    expect(
      applyOperations(scene, [
        { op: "delete", id: "boundary" },
        { op: "update", id: "child", parentId: null },
      ]).elements[1].parentId,
    ).toBeNull();
  });

  it("edits existing ink without exposing raw points and enforces count limits", () => {
    const scene: BoardScene = {
      ...emptyScene("react-flow"),
      elements: [
        {
          id: "ink",
          type: "ink",
          x: 0,
          y: 0,
          width: 20,
          height: 20,
          version: 1,
          props: {
            points: [
              [0, 0, 0.5],
              [20, 20, 1],
            ],
            color: "#112233",
            size: 2,
            pressure: true,
            w: 20,
            h: 20,
          },
        },
      ],
    };
    const next = applyOperations(scene, [
      { op: "update", id: "ink", x: 100, width: 40, height: 50, color: "#aabbcc" },
    ]);
    expect(next.elements[0]).toMatchObject({
      x: 100,
      width: 40,
      height: 50,
      props: { color: "#aabbcc" },
      version: 2,
    });
    const summary = summarize(next, 3);
    expect(summary).toMatchObject({ engine: "react-flow", elements: [{ ink: { pointCount: 2 } }] });
    expect(JSON.stringify(summary)).not.toContain('"points"');
    expect(applyOperations(next, [{ op: "delete", id: "ink" }]).elements[0].isDeleted).toBe(true);
    expect(() =>
      applyOperations(
        emptyScene("react-flow"),
        Array.from({ length: 301 }, (_, i) => create(`n${i}`)),
      ),
    ).toThrow();
  });

  it("automatically observes current and proposed relationships", () => {
    const scene = fixture();
    expect(flowDependencies(scene, { op: "delete", id: "child" }).sort()).toEqual([
      "boundary",
      "child",
      "edge",
      "other",
    ]);
    expect(
      flowDependencies(scene, { op: "update", id: "edge", source: "boundary" }).sort(),
    ).toEqual(["boundary", "child", "other"]);
  });

  it("validates referenced raster headers and bounds summary size without asset/ink data", () => {
    const scene = fixture();
    scene.elements[0].props = {
      ...defaultFlowProps("table"),
      imageId: "asset",
      rows: Array.from({ length: 100 }, () => ["x".repeat(4000), "y".repeat(4000)]),
    };
    const header = Buffer.alloc(33);
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(header);
    header.write("IHDR", 12);
    header.writeUInt32BE(8000, 16);
    header.writeUInt32BE(8000, 20);
    scene.files.asset = {
      id: "asset",
      mimeType: "image/png",
      dataURL: `data:image/png;base64,${header.toString("base64")}`,
      created: 0,
    };
    expect(() => validateScene(scene)).toThrow(/raster/);
    header.writeUInt32BE(10, 16);
    header.writeUInt32BE(10, 20);
    scene.files.asset.dataURL = `data:image/png;base64,${header.toString("base64")}`;
    const summary = summarize(validateScene(scene), 5);
    expect(Buffer.byteLength(JSON.stringify(summary))).toBeLessThan(128 * 1024 + 1024);
    expect(summary.elements[0]).toMatchObject({
      props: { imageId: "asset" },
      propsTruncated: true,
    });
    expect(JSON.stringify(summary)).not.toContain("base64");
  });
});
