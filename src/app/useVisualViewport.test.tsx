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
let events: EventTarget & {
  visualViewport?: typeof viewport;
  innerWidth: number;
  innerHeight: number;
};
let documentEvents: EventTarget & { visibilityState: string };
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
  events = Object.assign(new EventTarget(), {
    visualViewport: viewport,
    innerWidth: 810,
    innerHeight: 1080,
  });
  documentEvents = Object.assign(new EventTarget(), { visibilityState: "visible" });
  vi.stubGlobal("document", documentEvents);
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

it("discards stale landscape-shaped bounds when the layout changes while zoomed", async () => {
  Object.assign(events, { innerWidth: 1080, innerHeight: 778 });
  Object.assign(viewport, { width: 1080, height: 778 });
  await mount();
  expect(bounds()).toEqual(["0px", "0px", "1080px", "778px"]);

  // Replay the reported standalone Safari geometry; no device rotation required.
  Object.assign(events, { innerWidth: 810, innerHeight: 1048 });
  Object.assign(viewport, { width: 810, height: 1048, scale: 1.347043752670288 });
  viewport.dispatchEvent(new Event("resize"));
  expect(bounds()).toEqual(["0px", "0px", "810px", "1048px"]);
  expect(viewport.scale).toBe(1.347043752670288);
});

it.each(["pageshow", "visibilitychange"])(
  "remeasures on %s even if Safari omits viewport resize events",
  async (event) => {
    await mount();
    viewport.height = 1048;
    const target = event === "pageshow" ? events : documentEvents;
    target.dispatchEvent(new Event(event));
    expect(bounds()).toEqual(["0px", "0px", "810px", "1048px"]);
  },
);

it("ignores hidden geometry and remeasures when the app becomes visible", async () => {
  await mount();
  documentEvents.visibilityState = "hidden";
  Object.assign(viewport, { width: 1080, height: 778 });
  viewport.dispatchEvent(new Event("resize"));
  expect(bounds()).toEqual(["0px", "0px", "810px", "1080px"]);
  Object.assign(viewport, { width: 810, height: 1048 });
  documentEvents.visibilityState = "visible";
  documentEvents.dispatchEvent(new Event("visibilitychange"));
  expect(bounds()).toEqual(["0px", "0px", "810px", "1048px"]);
});

it("does not replace keyboard geometry just because the user pinch zooms", async () => {
  await mount();
  Object.assign(viewport, { height: 736, offsetTop: 280 });
  viewport.dispatchEvent(new Event("resize"));
  Object.assign(viewport, { height: 368, width: 405, scale: 2 });
  viewport.dispatchEvent(new Event("resize"));
  expect(bounds()).toEqual(["280px", "0px", "810px", "736px"]);
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
  events.dispatchEvent(new Event("pageshow"));
  documentEvents.dispatchEvent(new Event("visibilitychange"));
  expect(style.setProperty).not.toHaveBeenCalled();
});
