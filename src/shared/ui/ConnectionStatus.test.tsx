import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ConnectionStatus } from "./ConnectionStatus";
import { PlugIcon, UnplugIcon } from "./Icons";

let renderer: ReactTestRenderer;
beforeEach(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
afterEach(async () => {
  await act(async () => renderer?.unmount());
  vi.unstubAllGlobals();
});

it("switches between decorative plug shapes with an announced text label, never an agent dot", async () => {
  await act(async () => {
    renderer = create(<ConnectionStatus connected />);
  });
  const status = () => renderer.root.findByProps({ role: "status" });
  expect(status().children).toContain("Connected");
  expect(status().props).toMatchObject({ "aria-atomic": "true", "data-connected": true });
  expect(renderer.root.findAllByType(PlugIcon)).toHaveLength(1);
  expect(renderer.root.findAllByType("i")).toHaveLength(0);
  expect(renderer.root.findByType("svg").props["aria-hidden"]).toBe("true");

  await act(async () => renderer.update(<ConnectionStatus connected={false} />));
  expect(status().children).toContain("Disconnected");
  expect(status().props["data-connected"]).toBe(false);
  expect(renderer.root.findAllByType(UnplugIcon)).toHaveLength(1);
  expect(renderer.root.findAllByType(PlugIcon)).toHaveLength(0);
  expect(renderer.root.findByType("svg").props["aria-hidden"]).toBe("true");
});
