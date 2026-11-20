import { act } from "react";
import { create } from "react-test-renderer";
import type { ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { dispatchTestEvent } from "./dispatchTestEvent";

let renderer: ReactTestRenderer | undefined;
function Harness({ onTest }: { onTest: unknown }) {
  return <span>{typeof onTest}</span>;
}
beforeEach(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
afterEach(async () => {
  await act(async () => renderer?.unmount());
  vi.unstubAllGlobals();
});
async function mount(handler: unknown) {
  await act(async () => {
    renderer = create(<Harness onTest={handler} />);
  });
  if (!renderer) {
    throw new Error("Harness did not mount");
  }
  return renderer.root.findByType(Harness);
}
it("passes event arguments and the original props receiver", async () => {
  const handler = vi.fn();
  const instance = await mount(handler);
  const event = { key: "Enter" };
  await dispatchTestEvent(instance, "onTest", event);
  expect(handler).toHaveBeenCalledWith(event);
  expect(handler.mock.contexts[0]).toBe(instance.props);
});
it("does not finish dispatch until the asynchronous handler settles", async () => {
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const instance = await mount(() => gate);
  let completed = false;
  const dispatched = dispatchTestEvent(instance, "onTest").then(() => {
    completed = true;
  });
  await Promise.resolve();
  expect(completed).toBe(false);
  release();
  await dispatched;
  expect(completed).toBe(true);
});
it("waits for asynchronous handlers and propagates rejection", async () => {
  const failure = new Error("event failed");
  const handler = vi.fn().mockRejectedValue(failure);
  const instance = await mount(handler);
  await expect(dispatchTestEvent(instance, "onTest")).rejects.toBe(failure);
});
it("rejects absent and non-callable props at the boundary", async () => {
  const instance = await mount(42);
  await expect(dispatchTestEvent(instance, "missing")).rejects.toThrow("Missing test event");
  await expect(dispatchTestEvent(instance, "onTest")).rejects.toThrow("not callable");
});
