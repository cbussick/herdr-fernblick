import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ChatMessageCopyButton } from "./ChatMessageCopyButton";
import { copyCodeText } from "./copyCodeText";

vi.mock("./copyCodeText", () => ({ copyCodeText: vi.fn() }));
let renderer: ReactTestRenderer;
beforeEach(async () => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("window", { setTimeout, clearTimeout });
  vi.mocked(copyCodeText).mockReset().mockResolvedValue(undefined);
  await act(async () => {
    renderer = create(<ChatMessageCopyButton text={"**Plan**\n\n```js\nconst x = 1;\n```"} />);
  });
});
afterEach(async () => {
  await act(async () => renderer.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it("copies the full original message including markdown and code, then resets confirmation", async () => {
  const button = () => renderer.root.findByType("button");
  expect(button().props["aria-label"]).toBe("Copy message");
  expect(button().props["data-message-control"]).toBe(true);
  await act(async () => button().props.onClick());
  expect(copyCodeText).toHaveBeenCalledWith("**Plan**\n\n```js\nconst x = 1;\n```");
  expect(button().props["data-copy-status"]).toBe("copied");
  expect(renderer.root.findByProps({ role: "status" }).children).toEqual(["Message copied"]);
  await act(async () => vi.advanceTimersByTime(2500));
  expect(button().props["aria-label"]).toBe("Copy message");
});
it("reports failure and allows retry without claiming success", async () => {
  vi.mocked(copyCodeText).mockRejectedValueOnce(new Error("Clipboard unavailable"));
  await act(async () => renderer.root.findByType("button").props.onClick());
  expect(renderer.root.findByType("button").props["aria-label"]).toBe("Retry copy message");
  expect(renderer.root.findByProps({ role: "status" }).children.join("")).toContain("Copy failed");
  await act(async () => renderer.root.findByType("button").props.onClick());
  expect(renderer.root.findByType("button").props["data-copy-status"]).toBe("copied");
});
it("does not show stale confirmation when the message streams and copies the updated text", async () => {
  await act(async () => renderer.root.findByType("button").props.onClick());
  await act(async () => renderer.update(<ChatMessageCopyButton text="Completed reply" />));
  expect(renderer.root.findByType("button").props["aria-label"]).toBe("Copy message");
  await act(async () => renderer.root.findByType("button").props.onClick());
  expect(copyCodeText).toHaveBeenLastCalledWith("Completed reply");
});
it("cleans up its confirmation timer on unmount", async () => {
  await act(async () => renderer.root.findByType("button").props.onClick());
  expect(vi.getTimerCount()).toBe(1);
  await act(async () => renderer.unmount());
  expect(vi.getTimerCount()).toBe(0);
});
