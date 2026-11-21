function legacyClipboard(success: boolean) {
  const owner = new Window();
  const focused = owner.document.createElement("div");
  owner.document.body.append(focused);
  const focus = vi.spyOn(focused, "focus").mockImplementation(() => {});
  const range = { cloneRange: () => "saved range" };
  const selection = {
    rangeCount: 1,
    getRangeAt: () => range,
    removeAllRanges: vi.fn(),
    addRange: vi.fn(),
  };
  const textarea = {
    value: "",
    className: "",
    setAttribute: vi.fn(),
    select: vi.fn(),
    remove: vi.fn(),
  };
  const execCommand = vi.fn(() => success);
  vi.stubGlobal("window", { setTimeout, clearTimeout, getSelection: () => selection });
  vi.stubGlobal("document", {
    activeElement: focused,
    createElement: () => textarea,
    body: { append: vi.fn() },
    execCommand,
  });
  return { textarea, execCommand, focus, selection };
}

import { Window } from "happy-dom";
import { testText } from "../../shared/lib/testText";
import { dispatchTestEvent } from "../../shared/lib/dispatchTestEvent";
import { act } from "react";
import { create } from "react-test-renderer";
import type { ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatCodeBlock } from "./ChatCodeBlock";
import { copyCodeText } from "./copyCodeText";

describe("copying code blocks", () => {
  let renderer: ReactTestRenderer | undefined;
  const writeText = vi.fn();
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    vi.stubGlobal("window", { setTimeout, clearTimeout });
    writeText.mockReset().mockResolvedValue(undefined);
  });
  afterEach(async () => {
    if (renderer) {
      await act(async () => renderer!.unmount());
    }
    renderer = undefined;
    vi.unstubAllGlobals();
  });

  it("copies the exact code payload, excluding fences and toolbar labels", async () => {
    const value = "const x = '<tag>';\n  indented\n";
    await act(async () => {
      renderer = create(
        <ChatCodeBlock value={value} language="js">
          {value}
        </ChatCodeBlock>,
      );
    });
    await act(async () => dispatchTestEvent(renderer!.root.findByType("button"), "onClick"));
    expect(writeText).toHaveBeenCalledWith(value);
    expect(renderer!.root.findByType("button").children).toEqual(["Copied"]);
    expect(renderer!.root.findByProps({ role: "status" }).children).toEqual(["Code copied"]);
    await act(async () =>
      renderer!.update(<ChatCodeBlock value="new code">new code</ChatCodeBlock>),
    );
    expect(renderer!.root.findByType("button").children).toEqual(["Copy"]);
  });

  it.each(["unavailable", "rejected"])(
    "uses the HTTP-compatible fallback when Clipboard API is %s",
    async (mode) => {
      if (mode === "unavailable") {
        vi.stubGlobal("navigator", {});
      } else {
        writeText.mockRejectedValue(new Error("Permission denied"));
      }
      const { textarea, execCommand, focus, selection } = legacyClipboard(true);
      await copyCodeText("exact\n  payload");
      expect(textarea.value).toBe("exact\n  payload");
      expect(execCommand).toHaveBeenCalledWith("copy");
      expect(textarea.remove).toHaveBeenCalledOnce();
      expect(focus).toHaveBeenCalledWith({ preventScroll: true });
      expect(selection.addRange).toHaveBeenCalledWith("saved range");
    },
  );

  it("reports failure rather than falsely claiming success, and lets the user retry", async () => {
    writeText.mockRejectedValue(new Error("Permission denied"));
    const legacy = legacyClipboard(false);
    await act(async () => {
      renderer = create(<ChatCodeBlock value="code">code</ChatCodeBlock>);
    });
    await act(async () => dispatchTestEvent(renderer!.root.findByType("button"), "onClick"));
    expect(renderer!.root.findByType("button").children).toEqual(["Retry copy"]);
    expect(testText(renderer!.root.findByProps({ role: "status" }))).toContain("Copy failed");
    expect(legacy.textarea.remove).toHaveBeenCalledOnce();
    writeText.mockResolvedValue(undefined);
    await act(async () => dispatchTestEvent(renderer!.root.findByType("button"), "onClick"));
    expect(renderer!.root.findByType("button").children).toEqual(["Copied"]);
  });
});
