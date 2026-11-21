import { createElement } from "react";
import { act, create } from "react-test-renderer";
import { expect, it } from "vitest";
import { readTestProp } from "./readTestProp.js";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
it("preserves scalar and missing props, rejecting structured and callable values", async () => {
  let renderer: ReturnType<typeof create> | undefined;
  await act(async () => {
    renderer = create(
      createElement("div", {
        text: "label",
        count: 0,
        enabled: false,
        empty: null,
        structured: {},
        callable: () => {},
      }),
    );
  });
  if (!renderer) {
    throw new Error("Renderer was not created");
  }
  const mounted = renderer;
  try {
    const node = mounted.root.findByType("div");
    expect(
      ["text", "count", "enabled", "empty", "missing"].map((name) => readTestProp(node, name)),
    ).toEqual(["label", 0, false, null, undefined]);
    expect(() => readTestProp(node, "structured")).toThrow("not a scalar");
    expect(() => readTestProp(node, "callable")).toThrow("not a scalar");
  } finally {
    await act(async () => mounted.unmount());
  }
});
