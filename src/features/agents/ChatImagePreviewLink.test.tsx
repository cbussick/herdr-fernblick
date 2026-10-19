import { act, type ReactNode } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatMessageText } from "./ChatMessageText";

vi.mock("react-dom", () => ({ createPortal: (children: ReactNode) => children }));

describe("Markdown image previews", () => {
  let renderer: ReactTestRenderer;
  const opener = { isConnected: true, focus: vi.fn() };
  const dialog = {
    open: false,
    showModal: vi.fn(() => {
      dialog.open = true;
    }),
    close: vi.fn(() => {
      dialog.open = false;
    }),
  };
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("document", { body: {}, activeElement: opener });
    vi.clearAllMocks();
    dialog.open = false;
  });
  afterEach(async () => {
    await act(async () => renderer?.unmount());
    vi.unstubAllGlobals();
  });
  async function render(text: string) {
    await act(async () => {
      renderer = create(<ChatMessageText text={text} annotationSource="a1" />, {
        createNodeMock: (element) => (element.type === "dialog" ? dialog : null),
      });
    });
  }
  function click(src?: string) {
    return {
      button: 0,
      preventDefault: vi.fn(),
      target: { closest: () => (src ? { getAttribute: () => src } : null) },
    };
  }

  it("opens the lightbox first, exposes a safe external link, and restores focus on close", async () => {
    const src = "https://example.com/design.png";
    await render(`![Design](${src})`);
    expect(renderer.root.findAllByType("dialog")).toHaveLength(0);
    const event = click(src);
    await act(async () => renderer.root.findByType("a").props.onClick(event));
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(dialog.showModal).toHaveBeenCalledOnce();
    const modal = renderer.root.findByType("dialog");
    expect(modal.props["data-message-control"]).toBe(true);
    expect(modal.findByType("img").props.src).toBe(src);
    expect(modal.findByType("img").props.referrerPolicy).toBe("no-referrer");
    const link = modal.findByType("a");
    expect(link.children).toEqual(["Open link"]);
    expect(link.props.href).toBe(src);
    expect(link.props.target).toBe("_blank");
    expect(link.props.rel).toBe("noopener noreferrer");
    expect(link.props.onClick).toBeUndefined();
    await act(async () =>
      modal.findByProps({ "aria-label": "Close image preview" }).props.onClick(),
    );
    await act(async () => modal.props.onClose({ currentTarget: dialog }));
    expect(renderer.root.findAllByType("dialog")).toHaveLength(0);
    expect(opener.focus).toHaveBeenCalledOnce();
  });

  it("opens even unavailable images in the lightbox and keeps the external link after failure", async () => {
    await render("![Design](https://example.com/missing.png)");
    await act(async () => renderer.root.findByType("img").props.onError());
    // Keyboard activation has no image target and still opens the first image.
    await act(async () => renderer.root.findByType("a").props.onClick(click()));
    const modal = renderer.root.findByType("dialog");
    await act(async () => modal.findByType("img").props.onError());
    expect(modal.findByType("a").props.href).toBe("https://example.com/missing.png");
  });

  it("previews the clicked image inside a Markdown link without losing its destination", async () => {
    await render(
      "[![One](https://example.com/one.png) ![Two](https://example.com/two.png)](https://example.com/page)",
    );
    expect(renderer.root.findAllByType("a")).toHaveLength(1);
    await act(async () =>
      renderer.root.findByType("a").props.onClick(click("https://example.com/two.png")),
    );
    const modal = renderer.root.findByType("dialog");
    expect(modal.findByType("img").props.src).toBe("https://example.com/two.png");
    expect(modal.findByType("a").props.href).toBe("https://example.com/page");
  });

  it("preserves modified-click browser navigation", async () => {
    await render("![Design](https://example.com/design.png)");
    const event = { ...click(), ctrlKey: true };
    await act(async () => renderer.root.findByType("a").props.onClick(event));
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(renderer.root.findAllByType("dialog")).toHaveLength(0);
  });
});
