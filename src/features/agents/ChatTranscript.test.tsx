import { act, type ReactNode } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ChatTranscript, type ChatTranscriptProps } from "./ChatTranscript";

vi.mock("react-dom", () => ({ createPortal: (children: ReactNode) => children }));
let renderer: ReactTestRenderer;
let props: ChatTranscriptProps;
let resize: () => void;
let top: number;
let bottomFraction: number;
const viewport = {
  scrollHeight: 1000,
  clientHeight: 200,
  get scrollTop() {
    return top;
  },
  set scrollTop(value: number) {
    top = Math.max(0, Math.min(value, this.scrollHeight - this.clientHeight + bottomFraction));
  },
};
const disconnect = vi.fn();
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("document", { body: {} });
  vi.stubGlobal("requestAnimationFrame", (callback: () => void) => {
    callback();
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        resize = callback;
      }
      observe() {}
      disconnect = disconnect;
    },
  );
  disconnect.mockClear();
  top = 0;
  bottomFraction = 0;
  viewport.scrollHeight = 1000;
  viewport.clientHeight = 200;
  props = {
    showThinking: false,
    truncated: false,
    messages: [
      { id: "u", role: "user", text: "Earlier question", attachments: ["/api/uploads/image.png"] },
      { id: "a", role: "assistant", text: "Earlier reply" },
      { id: "t", role: "thinking", text: "Thinking detail" },
      { id: "tool", role: "tool", text: "Tool failed", toolName: "board_apply", isError: true },
      { id: "s", role: "status", text: "Session changed" },
      { id: "new", role: "user", text: "Next question" },
    ],
  };
  await act(async () => {
    renderer = create(<ChatTranscript {...props} />, {
      createNodeMock: (element) =>
        (element.props as Record<string, unknown>)["data-ui"] === "chat-transcript"
          ? viewport
          : null,
    });
  });
});
afterEach(async () => {
  await act(async () => renderer.unmount());
  vi.unstubAllGlobals();
});
function output() {
  return renderer.root.findByProps({ "data-ui": "chat-transcript" });
}
async function readerScrollTo(value: number) {
  await act(async () => {
    output().props.onWheel({ deltaY: value - viewport.scrollTop });
    viewport.scrollTop = value;
    output().props.onScroll();
  });
}
it("labels replies Agent and user messages You", () => {
  const messages = renderer.root.findAllByType("article");
  expect(messages.map((message) => message.findAllByType("span")[0].children.join(""))).toEqual([
    "You",
    "Agent",
    "You",
  ]);
});

it("renders all turns, status, tool errors and images with the shared thinking preference", async () => {
  let text = JSON.stringify(renderer.toJSON());
  for (const value of [
    "Earlier question",
    "Earlier reply",
    "Next question",
    "Tool failed",
    "Session changed",
  ])
    expect(text).toContain(value);
  expect(text).not.toContain("Thinking detail");
  expect(renderer.root.findByProps({ "aria-label": "Open attached image" })).toBeDefined();
  props = { ...props, showThinking: true, truncated: true };
  await act(async () => renderer.update(<ChatTranscript {...props} />));
  text = JSON.stringify(renderer.toJSON());
  expect(text).toContain("Thinking detail");
  expect(text).toContain("some content is omitted");
});
it("starts at the bottom and follows new output and viewport resizing when the reader follows", async () => {
  expect(top).toBe(800);
  viewport.scrollHeight = 1400;
  props = {
    ...props,
    messages: [...props.messages, { id: "reply", role: "assistant", text: "Streaming" }],
  };
  await act(async () => renderer.update(<ChatTranscript {...props} />));
  expect(top).toBe(1200);
  viewport.clientHeight = 500;
  await act(async () => resize());
  expect(top).toBe(900);
});
it.each(["viewport expansion", "content shrink"])(
  "keeps following after automatic clamping from %s before alignment",
  async (change) => {
    // Browser geometry changes can deliver a scroll event before our deferred alignment.
    if (change === "viewport expansion") viewport.clientHeight = 500;
    else viewport.scrollHeight = 700;
    viewport.scrollTop = viewport.scrollTop;
    await act(async () => output().props.onScroll());
    await act(async () => resize());
    expect(top).toBe(500);
    viewport.scrollHeight = 1400;
    await act(async () => renderer.update(<ChatTranscript {...props} />));
    expect(top).toBe(1400 - viewport.clientHeight);
  },
);
it("keeps following when layout expands and contracts before the browser scroll event", async () => {
  viewport.clientHeight = 500;
  viewport.scrollTop = top;
  // The second layout change hides the intermediate clamp from the observer.
  viewport.clientHeight = 200;
  await act(async () => output().props.onScroll());
  await act(async () => resize());
  expect(top).toBe(800);
  viewport.scrollHeight = 1120;
  await act(async () => renderer.update(<ChatTranscript {...props} />));
  expect(top).toBe(920);
});
it("still pauses for a small reader scroll after automatic clamping", async () => {
  viewport.clientHeight = 500;
  viewport.scrollTop = viewport.scrollTop;
  await act(async () => output().props.onScroll());
  await readerScrollTo(viewport.scrollTop - 0.5);
  await act(async () => resize());
  viewport.scrollHeight = 1400;
  await act(async () => renderer.update(<ChatTranscript {...props} />));
  expect(top).toBe(499.5);
});
it("does not resume a paused reader when geometry clamps before alignment", async () => {
  await readerScrollTo(300);
  await act(async () => renderer.update(<ChatTranscript {...props} />));
  viewport.clientHeight = 900;
  viewport.scrollTop = viewport.scrollTop;
  await act(async () => output().props.onScroll());
  await act(async () => resize());
  viewport.clientHeight = 200;
  await act(async () => resize());
  expect(top).toBe(300);
});
it.each([12, 1, 0.5])(
  "stops following after scrolling up %s pixels during streaming",
  async (distance) => {
    expect(top).toBe(800);
    // Delivery of our initial programmatic scroll must not change follow mode.
    await act(async () => output().props.onScroll());
    await readerScrollTo(800 - distance);
    viewport.scrollHeight = 1040;
    props = {
      ...props,
      messages: props.messages.map((message) =>
        message.id === "a" ? { ...message, text: "Earlier reply streaming" } : message,
      ),
    };
    await act(async () => renderer.update(<ChatTranscript {...props} />));
    expect(top).toBe(800 - distance);
    await act(async () => {
      resize();
      output().props.onLoadCapture();
      renderer.root.findByProps({ "data-testid": "chat-tool" }).props.onToggle();
    });
    expect(top).toBe(800 - distance);
  },
);
it.each(["touch", "ArrowUp", "PageUp", "Home", "Shift+Space", "scrollbar"])(
  "pauses following on upward %s input before browser scroll delivery",
  async (input) => {
    await act(async () => {
      if (input === "touch") {
        output().props.onTouchStart({ touches: [{ clientY: 100 }] });
        output().props.onTouchMove({ touches: [{ clientY: 100.5 }] });
      } else if (input === "scrollbar") {
        output().props.onPointerDown({
          pointerType: "mouse",
          button: 0,
          clientX: 199,
          currentTarget: {
            clientLeft: 0,
            clientWidth: 185,
            getBoundingClientRect: () => ({ left: 0 }),
          },
        });
      } else {
        output().props.onKeyDown({
          key: input === "Shift+Space" ? " " : input,
          shiftKey: input === "Shift+Space",
          target: viewport,
          currentTarget: viewport,
        });
      }
      // Streaming can render between the input and its native scroll event.
      viewport.scrollHeight = 1040;
      renderer.update(<ChatTranscript {...props} />);
    });
    expect(top).toBe(800);
    viewport.scrollTop = 799.5;
    await act(async () => output().props.onScroll());
    viewport.scrollHeight = 1080;
    await act(async () => renderer.update(<ChatTranscript {...props} />));
    expect(top).toBe(799.5);
  },
);
it("does not pause for downward touch, downward wheel or button activation", async () => {
  await act(async () => {
    output().props.onTouchStart({ touches: [{ clientY: 100 }] });
    output().props.onTouchMove({ touches: [{ clientY: 80 }] });
    output().props.onWheel({ deltaY: 12 });
    output().props.onKeyDown({ key: " ", shiftKey: true, target: {}, currentTarget: viewport });
    output().props.onPointerDown({ pointerType: "touch", button: 0 });
    viewport.scrollHeight = 1040;
    renderer.update(<ChatTranscript {...props} />);
  });
  expect(top).toBe(840);
});
it("resumes following only when the reader scrolls down to the bottom", async () => {
  await readerScrollTo(740);
  await readerScrollTo(788);
  viewport.scrollHeight = 1040;
  await act(async () => renderer.update(<ChatTranscript {...props} />));
  expect(top).toBe(788);
  // scrollTop can be fractional even though scrollHeight/clientHeight are rounded.
  await readerScrollTo(839.5);
  viewport.scrollHeight = 1080;
  await act(async () => renderer.update(<ChatTranscript {...props} />));
  expect(top).toBe(880);
});
it("preserves the reader position through streaming, clamped expansion and collapse", async () => {
  await readerScrollTo(300);
  props = {
    ...props,
    messages: [...props.messages, { id: "reply", role: "assistant", text: "Streaming" }],
  };
  await act(async () => renderer.update(<ChatTranscript {...props} />));
  expect(top).toBe(300);
  viewport.clientHeight = 900;
  await act(async () => resize());
  expect(top).toBe(100);
  // The browser's programmatic/clamped scroll event must not opt the reader into following.
  await act(async () => output().props.onScroll());
  viewport.clientHeight = 200;
  await act(async () => resize());
  expect(top).toBe(300);
  await act(async () => renderer.unmount());
  expect(disconnect).toHaveBeenCalledOnce();
});
it("ignores its own fractional clamped scroll when rounded geometry differs", async () => {
  await readerScrollTo(300);
  viewport.clientHeight = 900;
  // Browser scrollTop retains fractions; scrollHeight and clientHeight are rounded.
  bottomFraction = 0.5;
  await act(async () => resize());
  expect(top).toBe(100.5);
  await act(async () => output().props.onScroll());
  viewport.clientHeight = 200;
  await act(async () => resize());
  expect(top).toBe(300);
});
it("realigns parent-driven expansion even when message props do not change", async () => {
  await readerScrollTo(300);
  viewport.clientHeight = 900;
  await act(async () => renderer.update(<ChatTranscript {...props} />));
  expect(top).toBe(100);
  await act(async () => output().props.onScroll());
  viewport.clientHeight = 200;
  await act(async () => renderer.update(<ChatTranscript {...props} />));
  expect(top).toBe(300);
});
it("opens images in a shared modal and lets Escape close only that preview", async () => {
  await act(async () =>
    renderer.root.findByProps({ "aria-label": "Open attached image" }).props.onClick(),
  );
  const modal = renderer.root.findByProps({ "data-ui": "chat-image-preview" });
  expect(modal.findByType("img").props.src).toBe("/api/uploads/image.png");
  const stopPropagation = vi.fn();
  modal.props.onKeyDown({ key: "Escape", stopPropagation });
  expect(stopPropagation).toHaveBeenCalledOnce();
  modal.props.onCancel({ stopPropagation });
  expect(stopPropagation).toHaveBeenCalledTimes(2);
  await act(async () => modal.props.onClose({ currentTarget: { open: false } }));
  expect(renderer.root.findAllByProps({ "data-ui": "chat-image-preview" })).toHaveLength(0);
});
it("cycles only the selected message's gallery and keeps image-open state stable while navigating", async () => {
  const onImageOpenChange = vi.fn();
  props = {
    ...props,
    onImageOpenChange,
    messages: [
      {
        id: "u1",
        role: "user",
        text: "",
        attachments: ["/api/uploads/one.png", "/api/uploads/two.png"],
      },
      { id: "u2", role: "user", text: "", attachments: ["/api/uploads/other.png"] },
    ],
  };
  await act(async () => renderer.update(<ChatTranscript {...props} />));
  onImageOpenChange.mockClear();
  await act(async () =>
    renderer.root.findAllByProps({ "aria-label": "Open attached image" })[1].props.onClick(),
  );
  const modal = () => renderer.root.findByProps({ "data-ui": "chat-image-preview" });
  expect(modal().findByType("img").props.src).toBe("/api/uploads/two.png");
  expect(onImageOpenChange).toHaveBeenLastCalledWith(true);
  onImageOpenChange.mockClear();
  await act(async () => modal().findByProps({ "aria-label": "Next image" }).props.onClick());
  expect(modal().findByType("img").props.src).toBe("/api/uploads/one.png");
  await act(async () => modal().findByProps({ "aria-label": "Previous image" }).props.onClick());
  expect(modal().findByType("img").props.src).toBe("/api/uploads/two.png");
  expect(onImageOpenChange).not.toHaveBeenCalled();
  await act(async () => modal().props.onClose({ currentTarget: { open: false } }));
  expect(onImageOpenChange).toHaveBeenLastCalledWith(false);
});

it("shows the same unavailable attachment fallback and empty state in every container", async () => {
  await act(async () => renderer.root.findByProps({ alt: "User attachment" }).props.onError());
  expect(renderer.root.findByProps({ "aria-label": "Attachment unavailable" })).toBeDefined();
  props = { ...props, messages: [] };
  await act(async () => renderer.update(<ChatTranscript {...props} />));
  expect(JSON.stringify(renderer.toJSON())).toContain("No messages yet.");
  expect(output().props["data-empty"]).toBe(true);
});
