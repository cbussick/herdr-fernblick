import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useSkillPickerOverlay } from "./useSkillPickerOverlay";

let renderer: ReactTestRenderer;
let viewport: EventTarget & {
  width: number;
  height: number;
  offsetTop: number;
  offsetLeft: number;
};
let media: EventTarget & { matches: boolean };
let browser: EventTarget & {
  innerWidth: number;
  innerHeight: number;
  visualViewport?: typeof viewport;
};
const values = new Map<string, string>();
const focus = vi.fn();
const dialog = {
  open: false,
  style: { setProperty: (key: string, value: string) => values.set(key, value) },
  querySelector: () => ({ focus }),
  showModal: vi.fn(() => {
    dialog.open = true;
  }),
  close: vi.fn(() => {
    dialog.open = false;
  }),
};
function Probe({ open = true }: { open?: boolean }) {
  const { mobile, dialogRef } = useSkillPickerOverlay(open);
  return open && mobile ? <dialog ref={dialogRef} /> : <span />;
}
async function mount() {
  await act(async () => {
    renderer = create(<Probe />, {
      createNodeMock: (element) => (element.type === "dialog" ? dialog : null),
    });
  });
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  values.clear();
  vi.clearAllMocks();
  dialog.open = false;
  media = Object.assign(new EventTarget(), { matches: true });
  viewport = Object.assign(new EventTarget(), {
    width: 390,
    height: 844,
    offsetTop: 0,
    offsetLeft: 0,
  });
  browser = Object.assign(new EventTarget(), {
    innerWidth: 390,
    innerHeight: 844,
    visualViewport: viewport,
    matchMedia: () => media,
  });
  vi.stubGlobal("window", browser);
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  vi.unstubAllGlobals();
});

it("fits the visual viewport as the keyboard opens, pans and closes without refocusing search", async () => {
  await mount();
  expect(dialog.showModal).toHaveBeenCalledOnce();
  expect(focus).toHaveBeenCalledOnce();
  expect(values.get("--skills-height")).toBe("844px");
  await act(async () => {
    viewport.height = 400;
    viewport.dispatchEvent(new Event("resize"));
  });
  expect(values.get("--skills-height")).toBe("400px");
  expect(browser.innerHeight).toBe(844);
  await act(async () => {
    viewport.offsetTop = 70;
    viewport.offsetLeft = 4;
    viewport.width = 382;
    viewport.dispatchEvent(new Event("scroll"));
  });
  expect(Object.fromEntries(values)).toEqual({
    "--skills-top": "70px",
    "--skills-left": "4px",
    "--skills-width": "382px",
    "--skills-height": "400px",
  });
  await act(async () => {
    viewport.height = 844;
    viewport.offsetTop = 0;
    viewport.dispatchEvent(new Event("resize"));
  });
  expect(values.get("--skills-height")).toBe("844px");
  expect(values.get("--skills-top")).toBe("0px");
  expect(focus).toHaveBeenCalledOnce();
  expect(dialog.showModal).toHaveBeenCalledOnce();
});
it("falls back to the window viewport and removes subscriptions on close", async () => {
  browser.visualViewport = undefined;
  const remove = vi.spyOn(browser, "removeEventListener");
  await mount();
  await act(async () => {
    browser.innerHeight = 440;
    browser.dispatchEvent(new Event("resize"));
  });
  expect(values.get("--skills-height")).toBe("440px");
  await act(async () => renderer.update(<Probe open={false} />));
  expect(dialog.close).toHaveBeenCalledOnce();
  expect(remove.mock.calls.map(([type]) => type)).toEqual(["resize"]);
});
it("keeps wider layouts inline and switches modes when the width breakpoint changes", async () => {
  media.matches = false;
  await mount();
  expect(dialog.showModal).not.toHaveBeenCalled();
  await act(async () => {
    media.matches = true;
    media.dispatchEvent(new Event("change"));
  });
  expect(dialog.showModal).toHaveBeenCalledOnce();
  await act(async () => {
    media.matches = false;
    media.dispatchEvent(new Event("change"));
  });
  expect(dialog.close).toHaveBeenCalledOnce();
  expect(renderer.root.findAllByType("dialog")).toHaveLength(0);
});
it("removes viewport and media listeners on unmount", async () => {
  const removeViewport = vi.spyOn(viewport, "removeEventListener");
  const removeMedia = vi.spyOn(media, "removeEventListener");
  await mount();
  await act(async () => renderer.unmount());
  expect(removeViewport.mock.calls.map(([type]) => type)).toEqual(["resize", "scroll"]);
  expect(removeMedia.mock.calls.map(([type]) => type)).toEqual(["change"]);
  expect(dialog.close).toHaveBeenCalledOnce();
});
