import { expect, it } from "vitest";
import type { BoardElement, BoardScene } from "../../../packages/pi-live-chat/boardProtocol";
import { defaultFlowProps } from "../../../packages/pi-live-chat/flowProtocol";
import { mergeScene } from "./mergeScene";

const blank = (): BoardScene => ({
  engine: "react-flow",
  elements: [],
  files: {},
  background: "#ffffff",
});
const card = (id: string, version = 1, title = id): BoardElement => ({
  id,
  type: "component",
  kind: "card",
  x: 0,
  y: 0,
  width: 300,
  height: 180,
  version,
  parentId: null,
  props: { ...defaultFlowProps("card"), title },
});
it("merges independent component and pen additions without losing the engine", () => {
  const local = {
    ...blank(),
    elements: [
      {
        id: "ink",
        type: "ink" as const,
        x: 0,
        y: 0,
        width: 20,
        height: 20,
        version: 1,
        props: { points: [[2, 2, 0.5]], color: "#243044", size: 5, pressure: true, w: 20, h: 20 },
      },
    ],
  };
  const remote = { ...blank(), elements: [card("agent")] };
  const result = mergeScene(blank(), local, remote);
  expect(result.engine).toBe("react-flow");
  expect(result.elements.map((e) => e.id).sort()).toEqual(["agent", "ink"]);
});
it("keeps human competing component edits and independent agent edits", () => {
  const base = { ...blank(), elements: [card("a"), card("b")] };
  const local = { ...base, elements: [card("a", 2, "Human title"), card("b")] };
  const remote = {
    ...base,
    elements: [card("a", 2, "Agent title"), card("b", 2, "Updated other card")],
  };
  expect(mergeScene(base, local, remote).elements).toEqual([
    card("a", 2, "Human title"),
    card("b", 2, "Updated other card"),
  ]);
});
it("preserves component raster files and rejects incompatible content at the same asset ID", () => {
  const file = {
    id: "asset",
    mimeType: "image/png" as const,
    dataURL: "data:image/png;base64,YQ==",
    created: 1,
  };
  const element = { ...card("picture"), props: { ...defaultFlowProps("card"), imageId: "asset" } };
  const remote = { ...blank(), elements: [element], files: { asset: file } };
  expect(mergeScene(blank(), blank(), remote).files).toEqual({ asset: file });
  const local = { ...remote, files: { asset: { ...file, dataURL: "data:image/png;base64,Yg==" } } };
  expect(() => mergeScene(remote, local, remote)).toThrow("asset conflict");
});
it("does not require collected raster bytes for component tombstones during later merges", () => {
  const deleted = {
    ...card("old-picture", 2),
    isDeleted: true,
    props: { ...defaultFlowProps("card"), imageId: "collected-asset" },
  };
  const base = { ...blank(), elements: [deleted] };
  const remote = { ...base, elements: [...base.elements, card("new-card")] };
  expect(mergeScene(base, base, remote)).toEqual(remote);
});
it("pauses rather than publishing a new connection to a concurrently deleted node", () => {
  const base = { ...blank(), elements: [card("a"), card("b")] };
  const local = { ...base, elements: [{ ...card("a"), isDeleted: true }, card("b")] };
  const connection: BoardElement = {
    id: "edge",
    type: "connection",
    x: 0,
    y: 0,
    width: 1,
    height: 1,
    version: 1,
    source: "a",
    target: "b",
    sourceHandle: "right",
    targetHandle: "left",
    label: "Reads",
    color: "#596579",
  };
  expect(() =>
    mergeScene(base, local, { ...base, elements: [...base.elements, connection] }),
  ).toThrow("recovery");
});
it("never treats an engine change as an ordinary scene merge", () => {
  const native = { elements: [], files: {}, background: "#ffffff" };
  expect(() => mergeScene(native, blank(), native)).toThrow("engine changed");
  expect(() => mergeScene(blank(), blank(), native)).toThrow("engine changed");
});
