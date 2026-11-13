import { act, useLayoutEffect, useRef } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useConversationSize } from "./useConversationSize";

let renderer: ReactTestRenderer;
let size: ReturnType<typeof useConversationSize>;
let desktop: boolean;
let box: { width: number; height: number };
let measure: () => void;
let mediaChange: () => void;
const storage = new Map<string, string>();
const key = "fernblick:whiteboard-conversation-width";
const node = { parentElement: { getBoundingClientRect: () => box } };
const control = { focus: vi.fn(), setPointerCapture: vi.fn() };
function Harness() {
  const dock = useRef<HTMLElement>(null);
  const geometry = useConversationSize(dock);
  useLayoutEffect(() => {
    size = geometry;
  });
  return <section ref={dock} />;
}
async function mount() {
  await act(async () => {
    renderer = create(<Harness />, { createNodeMock: () => node });
  });
}
function pointer(x: number, y: number, pointerId = 1) {
  return {
    pointerId,
    clientX: x,
    clientY: y,
    button: 0,
    isPrimary: true,
    currentTarget: control,
    preventDefault() {},
  } as unknown as Parameters<typeof size.separator.onPointerDown>[0];
}
async function press(key: string, shiftKey = false) {
  const preventDefault = vi.fn();
  await act(async () =>
    size.separator.onKeyDown({
      key,
      shiftKey,
      preventDefault,
      stopPropagation() {},
      nativeEvent: {},
    } as unknown as Parameters<typeof size.separator.onKeyDown>[0]),
  );
  return preventDefault;
}
beforeEach(() => {
  desktop = true;
  box = { width: 1440, height: 824 };
  storage.clear();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("requestAnimationFrame", (callback: () => void) => {
    callback();
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
  vi.stubGlobal("window", {
    matchMedia: () => ({
      get matches() {
        return desktop;
      },
      addEventListener: (_: string, listener: () => void) => {
        mediaChange = listener;
      },
      removeEventListener: vi.fn(),
    }),
  });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        measure = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  vi.unstubAllGlobals();
});
it("bounds desktop dragging, persists only the completed gesture and restores width on reopen", async () => {
  await mount();
  expect(size.separator["aria-valuenow"]).toBe(448);
  await act(async () => size.separator.onPointerDown(pointer(992, 400)));
  await act(async () => size.separator.onPointerMove(pointer(840, 400)));
  expect(size.separator["aria-valuenow"]).toBe(600);
  expect(storage.has(key)).toBe(false);
  await act(async () => size.separator.onPointerUp(pointer(840, 400)));
  expect(storage.get(key)).toBe("600");
  await act(async () => renderer.unmount());
  await mount();
  expect(size.separator["aria-valuenow"]).toBe(600);
  await press("End");
  expect(size.separator["aria-valuenow"]).toBe(936);
  await press("Home");
  expect(size.separator["aria-valuenow"]).toBe(448);
  await act(async () => size.separator.onPointerDown(pointer(992, 400)));
  await act(async () => size.separator.onPointerUp(pointer(1400, 400)));
  expect(size.separator["aria-valuenow"]).toBe(448);
});
it("reacts to actual desktop size and collapses any enlarged pane to the default minimum", async () => {
  storage.set(key, "700");
  await mount();
  await press("ArrowLeft");
  expect(size.separator["aria-valuenow"]).toBe(716);
  expect(size.expanded).toBe(true);
  await act(async () => size.toggle());
  expect(size.expanded).toBe(false);
  expect(size.separator["aria-valuenow"]).toBe(448);
  expect(storage.get(key)).toBe("448");
  await act(async () => size.toggle());
  expect(size.expanded).toBe(true);
  expect(size.separator["aria-valuenow"]).toBe(720);
  await press("End");
  expect(size.separator["aria-valuenow"]).toBe(936);
  await act(async () => size.toggle());
  expect(size.separator["aria-valuenow"]).toBe(448);
  await press("ArrowLeft");
  expect(size.expanded).toBe(true);
  await act(async () => size.collapse());
  expect(size.separator["aria-valuenow"]).toBe(448);
});
it("restores cancelled drags and ignores other pointers and orientation changes mid-gesture", async () => {
  await mount();
  await act(async () => size.separator.onPointerDown(pointer(992, 400)));
  await act(async () => size.separator.onPointerMove(pointer(800, 400, 2)));
  expect(size.separator["aria-valuenow"]).toBe(448);
  await act(async () => size.separator.onPointerMove(pointer(800, 400)));
  expect(size.separator["aria-valuenow"]).toBe(640);
  expect(await press("Escape")).toHaveBeenCalled();
  expect(size.separator["aria-valuenow"]).toBe(448);
  expect(size.dragging).toBe(false);
  await act(async () => size.separator.onPointerDown(pointer(992, 400)));
  desktop = false;
  await act(async () => mediaChange());
  await act(async () => size.separator.onPointerMove(pointer(800, 300)));
  expect(size.dragging).toBe(false);
  expect(size.separator["aria-orientation"]).toBe("horizontal");
  expect(storage.has(key)).toBe(false);
});
it("snaps the mobile sheet to compact, half and full height, independently of desktop width", async () => {
  desktop = false;
  box = { width: 390, height: 720 };
  await mount();
  expect(size.separator["aria-valuenow"]).toBe(25);
  await act(async () => size.separator.onPointerDown(pointer(195, 540)));
  await act(async () => size.separator.onPointerMove(pointer(195, 380)));
  expect(size.separator["aria-valuenow"]).toBe(47);
  await act(async () => size.separator.onPointerUp(pointer(195, 380)));
  expect(size.separator["aria-valuenow"]).toBe(50);
  expect(size.expanded).toBe(true);
  expect(size.fullHeight).toBe(false);
  await act(async () => size.toggle());
  expect(size.separator["aria-valuenow"]).toBe(25);
  await act(async () => size.toggle());
  expect(size.fullHeight).toBe(true);
  await press("ArrowDown");
  expect(size.separator["aria-valuenow"]).toBe(50);
  expect(size.expanded).toBe(true);
  expect(size.fullHeight).toBe(false);
  await press("Home");
  expect(size.separator["aria-valuenow"]).toBe(25);
  expect(storage.has(key)).toBe(false);
  await act(async () => {
    box.height = 150;
    measure();
  });
  expect(size.separator["aria-valuenow"]).toBe(100);
});
it("clamps older saved widths to the default and adapts the minimum to viewport changes", async () => {
  storage.set(key, "320");
  await mount();
  expect(size.separator["aria-valuemin"]).toBe(448);
  expect(size.separator["aria-valuenow"]).toBe(448);
  expect(size.expanded).toBe(false);
  await press("End");
  box.width = 1024;
  await act(async () => measure());
  expect(size.separator["aria-valuemin"]).toBe(348);
  expect(size.separator["aria-valuenow"]).toBe(666);
  expect(storage.get(key)).toBe("936");
  await act(async () => size.toggle());
  expect(size.separator["aria-valuenow"]).toBe(348);
});
it("prevents shrinking mobile below default and handles keyboard-sized viewports", async () => {
  desktop = false;
  box = { width: 390, height: 800 };
  await mount();
  expect(size.separator["aria-valuemin"]).toBe(25);
  await act(async () => size.separator.onPointerDown(pointer(195, 600)));
  await act(async () => size.separator.onPointerMove(pointer(195, 790)));
  expect(size.separator["aria-valuenow"]).toBe(25);
  await act(async () => size.separator.onPointerUp(pointer(195, 790)));
  expect(size.expanded).toBe(false);
  box.height = 220;
  await act(async () => measure());
  expect(size.separator["aria-valuenow"]).toBe(80);
  expect(size.expanded).toBe(false);
  await press("ArrowUp");
  expect(size.fullHeight).toBe(true);
  await act(async () => size.toggle());
  expect(size.separator["aria-valuenow"]).toBe(80);
});
it("ignores invalid stored widths and still resizes with blocked storage", async () => {
  storage.set(key, "NaN");
  await mount();
  expect(size.separator["aria-valuenow"]).toBe(448);
  vi.stubGlobal("localStorage", {
    getItem() {
      throw new Error("blocked");
    },
    setItem() {
      throw new Error("blocked");
    },
  });
  await press("ArrowRight");
  expect(size.separator["aria-valuenow"]).toBe(448);
});
