import { act, StrictMode, useState, type ReactNode } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ImageLightbox } from "./ImageLightbox";

vi.mock("react-dom", () => ({ createPortal: (children: ReactNode) => children }));
let renderer: ReactTestRenderer;
const onClose = vi.fn();
const opener = { isConnected: true, focus: vi.fn() };
const nativeDialog = {
  open: false,
  showModal: vi.fn(() => {
    nativeDialog.open = true;
  }),
  close: vi.fn(() => {
    nativeDialog.open = false;
  }),
};
const images = ["/one.png", "/two.png", "/three.png"].map((url, index) => ({
  url,
  alt: `Attachment ${index + 1}`,
}));
function Gallery({ count = 3 }: { count?: number }) {
  const [index, setIndex] = useState(1 % count);
  return (
    <ImageLightbox
      images={images.slice(0, count)}
      index={index}
      onIndexChange={setIndex}
      onClose={onClose}
    />
  );
}
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("document", { body: {}, activeElement: opener });
  vi.clearAllMocks();
  nativeDialog.open = false;
  await act(async () => {
    renderer = create(<Gallery />, {
      createNodeMock: (element) => (element.type === "dialog" ? nativeDialog : null),
    });
  });
});
afterEach(async () => {
  await act(async () => renderer.unmount());
  vi.unstubAllGlobals();
});
const modal = () => renderer.root.findByType("dialog");
const current = () => modal().findByType("img").props.src;
it("opens a native modal once, cycles with buttons and arrows, wraps and restores opener focus", async () => {
  expect(nativeDialog.showModal).toHaveBeenCalledOnce();
  expect(current()).toBe("/two.png");
  await act(async () => modal().findByProps({ "aria-label": "Next image" }).props.onClick());
  expect(current()).toBe("/three.png");
  await act(async () => modal().findByProps({ "aria-label": "Next image" }).props.onClick());
  expect(current()).toBe("/one.png");
  const event = { key: "ArrowLeft", preventDefault: vi.fn(), stopPropagation: vi.fn() };
  await act(async () => modal().props.onKeyDown(event));
  expect(current()).toBe("/three.png");
  expect(event.preventDefault).toHaveBeenCalledOnce();
  expect(event.stopPropagation).toHaveBeenCalledOnce();
  await act(async () => modal().props.onKeyDown({ ...event, key: "ArrowRight" }));
  expect(current()).toBe("/one.png");
  expect(modal().findByProps({ role: "status" }).children.join("")).toBe("Image 1 of 3");
  expect(nativeDialog.showModal).toHaveBeenCalledOnce();
  expect(onClose).not.toHaveBeenCalled();
  await act(async () => renderer.unmount());
  expect(nativeDialog.close).toHaveBeenCalledOnce();
  expect(opener.focus).toHaveBeenCalledOnce();
});
it("isolates Escape and cancel, dismisses with Close or backdrop, but not image clicks", async () => {
  const stopPropagation = vi.fn();
  modal().props.onKeyDown({ key: "Escape", stopPropagation });
  modal().props.onCancel({ stopPropagation });
  expect(stopPropagation).toHaveBeenCalledTimes(2);
  const close = vi.fn();
  modal().props.onClick({ target: {}, currentTarget: { close } });
  expect(close).not.toHaveBeenCalled();
  const backdrop = { close };
  modal().props.onClick({ target: backdrop, currentTarget: backdrop });
  expect(close).toHaveBeenCalledOnce();
  await act(async () =>
    modal().findByProps({ "aria-label": "Close image preview" }).props.onClick(),
  );
  expect(nativeDialog.close).toHaveBeenCalledOnce();
  await act(async () => modal().props.onClose({ currentTarget: { open: false } }));
  expect(onClose).toHaveBeenCalledOnce();
});
it("retains navigation when an image fails and resets the fallback for the next image", async () => {
  await act(async () => modal().findByType("img").props.onError());
  expect(modal().findByProps({ "aria-label": "Attachment unavailable" })).toBeDefined();
  await act(async () => modal().findByProps({ "aria-label": "Next image" }).props.onClick());
  expect(current()).toBe("/three.png");
});
it("ignores a stale close event after StrictMode reopens the native dialog", async () => {
  await act(async () =>
    renderer.update(
      <StrictMode>
        <Gallery />
      </StrictMode>,
    ),
  );
  expect(nativeDialog.open).toBe(true);
  await act(async () => modal().props.onClose({ currentTarget: nativeDialog }));
  expect(onClose).not.toHaveBeenCalled();
  nativeDialog.close();
  await act(async () => modal().props.onClose({ currentTarget: nativeDialog }));
  expect(onClose).toHaveBeenCalledOnce();
});

it("hides cycling controls for a single image", async () => {
  await act(async () => renderer.update(<Gallery count={1} key="single" />));
  expect(current()).toBe("/one.png");
  expect(modal().findAllByProps({ "aria-label": "Previous image" })).toHaveLength(0);
  expect(modal().findAllByProps({ "aria-label": "Next image" })).toHaveLength(0);
  const preventDefault = vi.fn();
  modal().props.onKeyDown({ key: "ArrowLeft", preventDefault });
  expect(preventDefault).not.toHaveBeenCalled();
});
