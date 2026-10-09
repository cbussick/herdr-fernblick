import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useSinglePaneLayout } from "./useSinglePaneLayout";

let renderer: ReactTestRenderer;
let viewport: { width: number; height: number };
let screen: { width: number; height: number; orientation?: EventTarget };
let touch: { maxTouchPoints: number };
let coarsePointer: boolean;
let events: EventTarget;
function Probe() {
  return <span>{useSinglePaneLayout() ? "single" : "split"}</span>;
}
function layout() {
  return renderer.root.findByType("span").children[0];
}
async function resize(width: number, height: number) {
  await act(async () => {
    viewport = { width, height };
    events.dispatchEvent(new Event("resize"));
  });
}
beforeEach(async () => {
  viewport = { width: 834, height: 1194 };
  screen = { ...viewport, orientation: new EventTarget() };
  touch = { maxTouchPoints: 5 };
  coarsePointer = false;
  events = new EventTarget();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("navigator", touch);
  vi.stubGlobal(
    "window",
    Object.assign(events, {
      screen,
      matchMedia: (query: string) => ({
        matches:
          query === "(width < 48rem)"
            ? viewport.width < 768
            : query === "(width >= 75rem)"
              ? viewport.width >= 1200
              : query === "(any-pointer: coarse)"
                ? coarsePointer
                : viewport.height >= viewport.width,
      }),
    }),
  );
  await act(async () => {
    renderer = create(<Probe />);
  });
});
afterEach(async () => {
  await act(async () => renderer.unmount());
  vi.unstubAllGlobals();
});

it("keeps touch portrait full-width as the keyboard opens and closes", async () => {
  expect(layout()).toBe("single");
  await resize(834, 650);
  expect(layout()).toBe("single");
  await resize(834, 1194);
  expect(layout()).toBe("single");
});
it("recognizes coarse-pointer browsers that do not expose touch points", async () => {
  touch.maxTouchPoints = 0;
  coarsePointer = true;
  await resize(834, 650);
  expect(layout()).toBe("single");
});
it("handles physical rotation with the keyboard still open", async () => {
  await resize(834, 650);
  screen.width = 1194;
  screen.height = 834;
  await resize(1194, 600);
  expect(layout()).toBe("split");
  await resize(834, 600);
  screen.width = 834;
  screen.height = 1194;
  await act(async () => {
    screen.orientation!.dispatchEvent(new Event("change"));
  });
  expect(layout()).toBe("single");
});
it("supports legacy orientation events", async () => {
  await act(async () => renderer.unmount());
  screen.orientation = undefined;
  await act(async () => {
    renderer = create(<Probe />);
  });
  await resize(834, 650);
  screen.width = 1194;
  screen.height = 834;
  await act(async () => {
    events.dispatchEvent(new Event("orientationchange"));
  });
  expect(layout()).toBe("split");
});
it("preserves desktop viewport resizing even on a portrait monitor", async () => {
  touch.maxTouchPoints = 0;
  await resize(834, 650);
  expect(layout()).toBe("split");
  await resize(834, 1194);
  expect(layout()).toBe("single");
});
it("preserves narrow-phone, wide-desktop and portrait split-view breakpoints", async () => {
  await resize(1200, 1600);
  expect(layout()).toBe("split");
  screen.width = 1194;
  screen.height = 834;
  await resize(700, 400);
  expect(layout()).toBe("single");
  await resize(834, 1000);
  expect(layout()).toBe("single");
});
