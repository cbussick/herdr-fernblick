import { describe, expect, it } from "vitest";
import { defaults, example, kinds, makeNode, restore, serialize, validData } from "./model";

describe("component canvas records", () => {
  it.each(kinds)("makes valid, independently editable %s props", (kind) => {
    const first = defaults(kind);
    const second = defaults(kind);
    first.fields[0]!.value = "Changed";
    expect(second.fields[0]!.value).toBe("Value");
    expect(validData(first)).toBe(true);
  });
  it("round-trips editable props, boundaries, edges and viewport", () => {
    const diagram = example();
    diagram.viewport = { x: 12, y: -30, zoom: 0.8 };
    const restored = restore(serialize(diagram));
    expect(restored.nodes.map((n) => n.data)).toEqual(diagram.nodes.map((n) => n.data));
    expect(restored.nodes.find((n) => n.id === "api")!.parentId).toBe("platform");
    expect(restored.viewport).toEqual(diagram.viewport);
    expect(restored.edges).toHaveLength(2);
  });
  it("does not persist transient selection, measurements or dragging", () => {
    const node = makeNode("card", 0, 0);
    node.selected = true;
    node.dragging = true;
    node.measured = { width: 300, height: 120 };
    const parsed = JSON.parse(serialize({ nodes: [node], edges: [] }));
    expect(parsed.nodes[0]).not.toHaveProperty("selected");
    expect(parsed.nodes[0]).not.toHaveProperty("dragging");
    expect(parsed.nodes[0]).not.toHaveProperty("measured");
  });
  it("restores React Flow resize dimensions rather than reverting to defaults", () => {
    const node = makeNode("card", 0, 0);
    node.width = 460;
    node.height = 250;
    const restored = restore(serialize({ nodes: [node], edges: [] }));
    expect(restored.nodes[0]!.style).toMatchObject({ width: 460, height: 250 });
  });
  it("rejects foreign image URLs, malformed fields and mismatched table cells", () => {
    expect(validData({ ...defaults("card"), image: "https://example.com/image.png" })).toBe(false);
    expect(validData({ ...defaults("detail"), fields: [{ label: "Bad" }] })).toBe(false);
    expect(validData({ ...defaults("table"), rows: [["only one cell"]] })).toBe(false);
    expect(validData({ ...defaults("card"), color: "url(external)" })).toBe(false);
  });
  it("rejects unsupported versions, duplicate IDs, dangling edges and invalid parents", () => {
    const data = JSON.parse(serialize(example()));
    expect(() => restore(JSON.stringify({ ...data, version: 9 }))).toThrow();
    expect(() =>
      restore(JSON.stringify({ ...data, nodes: [data.nodes[0], data.nodes[0]] })),
    ).toThrow();
    expect(() =>
      restore(
        JSON.stringify({ ...data, edges: [{ id: "bad", source: "missing", target: "api" }] }),
      ),
    ).toThrow();
    data.nodes[1].parentId = "api";
    expect(() => restore(JSON.stringify(data))).toThrow();
  });
  it("rejects invalid coordinates and oversized records", () => {
    const data = JSON.parse(serialize(example()));
    data.nodes[0].position.x = "wrong";
    expect(() => restore(JSON.stringify(data))).toThrow();
    expect(() => restore(" ".repeat(5000001))).toThrow();
  });
});
