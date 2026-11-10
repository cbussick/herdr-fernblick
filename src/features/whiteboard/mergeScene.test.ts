import { expect, it } from "vitest";
import { boardSceneSchema, type BoardScene } from "../../../packages/pi-live-chat/boardProtocol";
import { canonical, mergeScene } from "./mergeScene";
import { scene } from "./testFixtures";

const blank = (): BoardScene => ({
  engine: "react-flow",
  elements: [],
  files: {},
  background: "#ffffff",
});
const named = (id: string, version = 1) => ({ ...scene(version).elements[0], id });
it("combines independent additions exactly once in both merge orders", () => {
  const local = { ...blank(), elements: [named("human")] };
  const remote = { ...blank(), elements: [named("agent")] };
  for (const [l, r] of [
    [local, remote],
    [remote, local],
  ]) {
    const merged = mergeScene(blank(), l, r);
    expect(merged.elements.map((e) => e.id).sort()).toEqual(["agent", "human"]);
    expect(mergeScene(r, merged, r)).toEqual(merged);
  }
});
it("keeps remote-only edits, local competing edits, and a remote addition", () => {
  const base = { ...blank(), elements: [named("one"), named("two")] };
  const local = { ...base, elements: [named("one", 2), named("two")] };
  const remote = { ...base, elements: [named("one", 3), named("two", 4), named("new")] };
  const merged = mergeScene(base, local, remote);
  expect(merged.elements).toEqual([named("one", 2), named("two", 4), named("new")]);
});
it.each(["local", "remote"])(
  "keeps a %s deletion over a concurrent edit without resurrecting the shape",
  (side) => {
    const base = scene();
    const deleted = { ...base, elements: [] };
    const result =
      side === "local" ? mergeScene(base, deleted, scene(2)) : mergeScene(base, scene(2), deleted);
    expect(result.elements[0].isDeleted).toBe(true);
  },
);
it("retains tombstones and does not treat unseen additions as deletions", () => {
  const remote = {
    ...scene(),
    elements: [named("box"), named("new"), { ...named("dead"), isDeleted: true }],
  };
  expect(mergeScene(scene(), scene(), remote)).toEqual(remote);
});
it("allows an intentional local undo of an acknowledged deletion", () => {
  const deleted = { ...scene(), elements: [{ ...named("box"), isDeleted: true }] };
  expect(mergeScene(deleted, scene(2), deleted).elements[0].isDeleted).toBe(false);
});
it("rejects fresh ID collisions instead of overwriting either draft", () => {
  expect(() => mergeScene(blank(), scene(), scene(2))).toThrow("collision");
});
it("preserves local ordering and places incoming additions without losing records", () => {
  const base = { ...blank(), elements: [named("a"), named("b")] };
  const local = { ...base, elements: [named("b"), named("a")] };
  const remote = { ...base, elements: [named("a"), named("new"), named("b")] };
  expect(mergeScene(base, local, remote).elements.map((e) => e.id)).toEqual(["b", "a", "new"]);
});
it("canonicalizes nested metadata", () => {
  expect(canonical({ b: 1, a: { d: 2, c: 3 } })).toBe(canonical({ a: { c: 3, d: 2 }, b: 1 }));
});
it("enforces merged shape limits", () => {
  const local = { ...blank(), elements: Array.from({ length: 2000 }, (_, i) => named("l" + i)) };
  const remote = { ...blank(), elements: [named("agent")] };
  expect(() => mergeScene(blank(), local, remote)).toThrow();
  expect(boardSceneSchema.parse(scene())).toEqual(scene());
});
