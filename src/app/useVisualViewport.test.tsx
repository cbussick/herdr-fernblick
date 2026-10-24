import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useVisualViewport } from "./useVisualViewport";

let renderer: ReactTestRenderer | undefined;
let viewport: EventTarget & {
  width: number;
  height: number;
  offsetTop: number;
  offsetLeft: number;
  scale: number;
};
let events: EventTarget & { visualViewport?: typeof viewport };
let properties: Map<string, string>;
const style = { setProperty: vi.fn(), removeProperty: vi.fn() };
function Fixture() {
  return <div ref={useVisualViewport()} />;
}
async function mount() {
  await act(async () => {
    renderer = create(<Fixture />, { createNodeMock: () => ({ style }) });
  });
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  properties = new Map();
  style.setProperty.mockImplementation((name: string, value: string) =>
    properties.set(name, value),
  );
  style.removeProperty.mockImplementation((name: string) => properties.delete(name));
  viewport = Object.assign(new EventTarget(), {
    width: 810,
    height: 1080,
    offsetTop: 0,
    offsetLeft: 0,
    scale: 1,
  });
  events = Object.assign(new EventTarget(), { visualViewport: viewport });
  vi.stubGlobal("window", events);
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
});
function bounds() {
  return ["top", "left", "width", "height"].map((name) => properties.get(`--app-viewport-${name}`));
}

it("uses the visible rectangle initially without scrolling or focusing anything", async () => {
  await mount();
  expect(bounds()).toEqual(["0px", "0px", "810px", "1080px"]);
});

it("tracks keyboard resize and focus panning independently of layout resizing", async () => {
  await mount();
  viewport.height = 736;
  viewport.dispatchEvent(new Event("resize"));
  expect(bounds()).toEqual(["0px", "0px", "810px", "736px"]);
  viewport.offsetTop = 280;
  viewport.offsetLeft = 4;
  viewport.dispatchEvent(new Event("scroll"));
  expect(bounds()).toEqual(["280px", "4px", "810px", "736px"]);
  viewport.offsetTop = 0;
  viewport.offsetLeft = 0;
  viewport.height = 1080;
  viewport.dispatchEvent(new Event("resize"));
  expect(bounds()).toEqual(["0px", "0px", "810px", "1080px"]);
});

it("also handles window resize for rotation and desktop window changes", async () => {
  await mount();
  viewport.width = 1080;
  viewport.height = 810;
  events.dispatchEvent(new Event("resize"));
  expect(bounds()).toEqual(["0px", "0px", "1080px", "810px"]);
});

it("does not reflow the app to a pinch-zoomed viewport and resumes at normal scale", async () => {
  await mount();
  viewport.scale = 2;
  viewport.width = 405;
  viewport.height = 540;
  viewport.offsetTop = 100;
  viewport.dispatchEvent(new Event("resize"));
  viewport.dispatchEvent(new Event("scroll"));
  expect(bounds()).toEqual(["0px", "0px", "810px", "1080px"]);
  viewport.scale = 1;
  viewport.width = 810;
  viewport.height = 736;
  viewport.dispatchEvent(new Event("resize"));
  expect(bounds()).toEqual(["100px", "0px", "810px", "736px"]);
});

it("ignores transient empty viewport geometry", async () => {
  await mount();
  viewport.height = 0;
  viewport.dispatchEvent(new Event("resize"));
  expect(bounds()).toEqual(["0px", "0px", "810px", "1080px"]);
});

it("leaves CSS fallbacks intact when VisualViewport is unavailable", async () => {
  delete events.visualViewport;
  await mount();
  expect(style.setProperty).not.toHaveBeenCalled();
});

it("removes geometry and all event listeners on unmount", async () => {
  await mount();
  await act(async () => renderer!.unmount());
  renderer = undefined;
  expect(properties.size).toBe(0);
  style.setProperty.mockClear();
  viewport.dispatchEvent(new Event("resize"));
  viewport.dispatchEvent(new Event("scroll"));
  events.dispatchEvent(new Event("resize"));
  expect(style.setProperty).not.toHaveBeenCalled();
});
