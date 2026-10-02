import { act, type ReactNode } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ChatTranscript, type ChatTranscriptProps } from "./ChatTranscript";

vi.mock("react-dom", () => ({ createPortal: (children: ReactNode) => children }));
let renderer: ReactTestRenderer;
let props: ChatTranscriptProps;
let resize: () => void;
let top: number;
const viewport = {
  scrollHeight: 1000,
  clientHeight: 200,
  get scrollTop() {
    return top;
  },
  set scrollTop(value: number) {
    top = Math.max(0, Math.min(value, this.scrollHeight - this.clientHeight));
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
  viewport.scrollHeight = 1000;
  viewport.clientHeight = 200;
  props = {
    agentName: "Pi",
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
  expect(renderer.root.findByProps({ "data-testid": "chat-tool" }).props.className).toContain(
    "chat-tool--error",
  );
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
it("preserves the reader position through streaming, clamped expansion and collapse", async () => {
  viewport.scrollTop = 300;
  await act(async () => output().props.onScroll());
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
it("realigns parent-driven expansion even when message props do not change", async () => {
  viewport.scrollTop = 300;
  await act(async () => output().props.onScroll());
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
  await act(async () => modal.props.onClose());
  expect(renderer.root.findAllByProps({ "data-ui": "chat-image-preview" })).toHaveLength(0);
});
it("shows the same unavailable attachment fallback and empty state in every container", async () => {
  await act(async () => renderer.root.findByProps({ alt: "User attachment" }).props.onError());
  expect(renderer.root.findByProps({ "aria-label": "Attachment unavailable" })).toBeDefined();
  props = { ...props, messages: [] };
  await act(async () => renderer.update(<ChatTranscript {...props} />));
  expect(JSON.stringify(renderer.toJSON())).toContain("No messages yet.");
  expect(output().props["data-empty"]).toBe(true);
});
