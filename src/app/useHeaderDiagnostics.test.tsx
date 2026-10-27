import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vitest";
import { getHeaderDiagnostics, useHeaderDiagnostics } from "./useHeaderDiagnostics";

let renderer: ReactTestRenderer | undefined;
afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
});
function Fixture() {
  useHeaderDiagnostics();
  return null;
}

it("retains visible conversation geometry through overview navigation without copying content", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const visual = Object.assign(new EventTarget(), {
    width: 810,
    height: 1048,
    offsetTop: 0,
    offsetLeft: 0,
    pageTop: 0,
    pageLeft: 0,
    scale: 1,
  });
  const browser = Object.assign(new EventTarget(), {
    innerWidth: 810,
    innerHeight: 1048,
    scrollX: 0,
    scrollY: 0,
    screen: { width: 810, height: 1080 },
    visualViewport: visual,
  });
  vi.stubGlobal("window", browser);
  let top = 0;
  let consoleVisible = true;
  const node = {
    getBoundingClientRect: () => ({ x: 0, y: top, width: 810, height: 140 }),
    parentElement: null,
    querySelector: () => null,
    get textContent() {
      throw new Error("Must not read conversation content");
    },
  };
  const hidden = { getBoundingClientRect: () => ({ width: 0, height: 0 }) };
  vi.stubGlobal("document", {
    querySelector: (selector: string) =>
      selector.includes("console") ? (consoleVisible ? node : null) : hidden,
    querySelectorAll: () => (consoleVisible ? [node] : []),
  });
  vi.stubGlobal("getComputedStyle", () => ({
    paddingTop: "12px",
    position: "static",
    backgroundColor: "rgb(255, 255, 255)",
    filter: "none",
    backdropFilter: "none",
    transform: "none",
    overflow: "visible",
    getPropertyValue: () => "none",
  }));
  let resized: () => void = () => {};
  const disconnect = vi.fn();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        resized = callback;
      }
      observe = vi.fn();
      disconnect = disconnect;
    },
  );
  await act(async () => {
    renderer = create(<Fixture />);
  });
  expect(getHeaderDiagnostics()).toMatchObject({
    version: 1,
    console: {
      header: { bounds: { y: 0 }, paddingTop: "12px" },
      viewport: { visual: { height: 1048, offsetTop: 0, scale: 1 } },
    },
  });
  expect(getHeaderDiagnostics()).not.toHaveProperty("overview");
  top = 24;
  resized();
  expect(getHeaderDiagnostics()).toMatchObject({ console: { header: { bounds: { y: 24 } } } });
  visual.offsetTop = 50;
  visual.dispatchEvent(new Event("scroll"));
  expect(getHeaderDiagnostics()).toMatchObject({
    console: { viewport: { visual: { offsetTop: 50 } } },
  });
  consoleVisible = false;
  await act(async () => {
    renderer!.update(<Fixture />);
  });
  expect(getHeaderDiagnostics()).toHaveProperty("console");
  const retained = JSON.stringify(getHeaderDiagnostics());
  await act(async () => {
    renderer!.unmount();
  });
  renderer = undefined;
  expect(disconnect).toHaveBeenCalled();
  consoleVisible = true;
  top = 999;
  browser.dispatchEvent(new Event("resize"));
  visual.dispatchEvent(new Event("scroll"));
  expect(JSON.stringify(getHeaderDiagnostics())).toBe(retained);
});
