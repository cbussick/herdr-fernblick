import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatMessageText } from "./ChatMessageText";

describe("Markdown image loading", () => {
  let renderer: ReactTestRenderer | undefined;
  beforeEach(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
  afterEach(async () => {
    if (renderer) await act(async () => renderer!.unmount());
    renderer = undefined;
    vi.unstubAllGlobals();
  });

  it("falls back to a link on failure and tries again for a changed URL", async () => {
    const src = "https://example.com/missing.png";
    await act(async () => {
      renderer = create(
        <ChatMessageText text={`Before ![Design](${src}) after`} annotationSource="a1" />,
      );
    });
    await act(async () => renderer!.root.findByType("img").props.onError());
    expect(renderer!.root.findAllByType("img")).toHaveLength(0);
    const link = renderer!.root.findByType("a");
    expect(link.props.href).toBe(src);
    expect(link.props["data-message-control"]).toBe(true);
    expect(link.findByType("span").children).toEqual(["Image unavailable — ", "Design"]);
    await act(async () => {
      renderer!.update(
        <ChatMessageText
          text="Before ![Design](https://example.com/new.png) after"
          annotationSource="a1"
        />,
      );
    });
    expect(renderer!.root.findByType("img").props.src).toBe("https://example.com/new.png");
  });
});
