import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatMessageText } from "./ChatMessageText";

describe("editing highlighted passages", () => {
  let renderer: ReactTestRenderer;
  let collapsed = true;
  const edit = vi.fn();
  const rect = { left: 10, top: 20, bottom: 40 } as DOMRect;
  const element = { getBoundingClientRect: () => rect };
  const highlights = [
    { id: "first", start: 0, end: 8 },
    { id: "second", start: 4, end: 12 },
  ];
  beforeEach(async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("window", { getSelection: () => ({ isCollapsed: collapsed }) });
    collapsed = true;
    edit.mockReset();
    await act(async () => {
      renderer = create(
        <ChatMessageText text="abcdefghijkl" highlights={highlights} onAnnotationEdit={edit} />,
      );
    });
  });
  afterEach(async () => {
    await act(async () => renderer.unmount());
    vi.unstubAllGlobals();
  });
  function event() {
    return {
      currentTarget: element,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      nativeEvent: { isComposing: false },
    };
  }
  it("opens the matching comment at the tapped passage, choosing the newest overlapping entry", () => {
    const marks = renderer.root.findAllByType("mark");
    expect(marks.map((mark) => mark.props["data-annotation-id"])).toEqual([
      "first",
      "second",
      "second",
    ]);
    const click = event();
    marks[1].props.onClick(click);
    expect(edit.mock.calls[0][0]).toBe("second");
    expect(edit.mock.calls[0][1]()).toBe(rect);
    expect(click.preventDefault).toHaveBeenCalledOnce();
    expect(click.stopPropagation).toHaveBeenCalledOnce();
  });
  it("does not open an editor or prevent copying while selecting highlighted text", () => {
    collapsed = false;
    const click = event();
    renderer.root.findAllByType("mark")[0].props.onClick(click);
    expect(edit).not.toHaveBeenCalled();
    expect(click.preventDefault).not.toHaveBeenCalled();
  });
  it.each(["Enter", " "])("supports keyboard activation with %s", (key) => {
    const mark = renderer.root.findAllByType("mark")[0];
    expect(mark.props.role).toBe("button");
    expect(mark.props.tabIndex).toBe(0);
    const keyEvent = { ...event(), key };
    mark.props.onKeyDown(keyEvent);
    expect(edit.mock.calls[0][0]).toBe("first");
    expect(keyEvent.preventDefault).toHaveBeenCalledOnce();
    expect(keyEvent.stopPropagation).toHaveBeenCalledOnce();
  });
  it("ignores IME confirmation and unrelated keys", () => {
    const mark = renderer.root.findAllByType("mark")[0];
    mark.props.onKeyDown({ ...event(), key: "Enter", nativeEvent: { isComposing: true } });
    mark.props.onKeyDown({ ...event(), key: "ArrowRight" });
    expect(edit).not.toHaveBeenCalled();
  });
  it("keeps read-only highlights noninteractive when no edit handler is supplied", async () => {
    await act(async () => {
      renderer.update(<ChatMessageText text="abcdefghijkl" highlights={highlights} />);
    });
    const mark = renderer.root.findAllByType("mark")[0];
    expect(mark.props.role).toBeUndefined();
    expect(mark.props.tabIndex).toBeUndefined();
    const click = event();
    mark.props.onClick(click);
    expect(click.preventDefault).not.toHaveBeenCalled();
    expect(edit).not.toHaveBeenCalled();
  });
  it("keeps every source character and raw offsets across formatting and links", () => {
    const text = "Before **[Read docs](https://example.com)** then `main`.";
    const start = text.indexOf("Read docs");
    const html = renderToStaticMarkup(
      <ChatMessageText
        text={text}
        annotationSource="a1"
        highlights={[{ id: "formatted", start, end: text.indexOf("main") + 4 }]}
        onAnnotationEdit={edit}
      />,
    );
    expect(html.replace(/<[^>]+>/g, "")).toBe(text);
    expect(html).toContain('data-annotation-id="formatted"');
    expect(html.match(/<a /g)).toHaveLength(1);
    expect(html.match(/role="button"/g)!.length).toBeGreaterThan(1);
  });
});
