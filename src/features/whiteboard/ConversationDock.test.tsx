import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ConversationDock, type WhiteboardConversation } from "./ConversationDock";

let renderer: ReactTestRenderer;
let conversation: Omit<WhiteboardConversation, "onSend"> & { onSend: () => void };
const activity = { message: "", warning: false, working: false };
function render(disabled = false, inert = false) {
  return (
    <ConversationDock
      conversation={conversation}
      activity={activity}
      disabled={disabled}
      inert={inert}
      history={
        <details>
          <summary>Saved snapshots (1)</summary>
        </details>
      }
    />
  );
}
function text() {
  return JSON.stringify(renderer.toJSON());
}
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  activity.message = "";
  activity.warning = false;
  activity.working = false;
  conversation = {
    agentName: "Pi",
    showThinking: false,
    draft: "",
    sending: false,
    onDraftChange: vi.fn(),
    onSend: vi.fn(),
    snapshot: {
      truncated: false,
      messages: [
        { id: "u1", role: "user", text: "Old question" },
        { id: "a1", role: "assistant", text: "Old reply" },
        { id: "u2", role: "user", text: "New question" },
        { id: "t2", role: "thinking", text: "Private thought" },
        { id: "a2", role: "assistant", text: "First response" },
        { id: "tool", role: "tool", text: "Tool failure", toolName: "board_apply", isError: true },
        { id: "a3", role: "assistant", text: "Final response" },
      ],
    },
  };
  await act(async () => {
    renderer = create(render());
  });
});
afterEach(async () => {
  await act(async () => renderer.unmount());
  vi.unstubAllGlobals();
});
it("streams the same response and retains it over a missing live snapshot", async () => {
  conversation.snapshot = {
    truncated: false,
    messages: [{ id: "stream", role: "assistant", text: "Partial" }],
  };
  await act(async () => renderer.update(render()));
  expect(text()).toContain("Partial");
  conversation.snapshot = {
    truncated: true,
    messages: [{ id: "stream", role: "assistant", text: "Partial response completed" }],
  };
  await act(async () => renderer.update(render()));
  expect(text()).toContain("Partial response completed");
  conversation.snapshot = undefined;
  await act(async () => renderer.update(render(true)));
  expect(text()).toContain("Partial response completed");
  expect(text()).toContain("some content is omitted");
});
it("does not present the previous turn as a reply to a newly received prompt", async () => {
  conversation.snapshot = {
    ...conversation.snapshot!,
    messages: [
      ...conversation.snapshot!.messages,
      { id: "u3", role: "user", text: "Next question" },
    ],
  };
  await act(async () => renderer.update(render()));
  expect(text()).not.toContain("Reply ready");
  expect(text()).toContain("Final response");
  expect(text()).toContain("Next question");
});
it("leaves Enter and IME composition alone; only Cmd/Ctrl+Enter submits", async () => {
  conversation.draft = "A question";
  await act(async () => renderer.update(render()));
  const keydown = renderer.root.findByType("textarea").props.onKeyDown;
  const preventDefault = vi.fn();
  await act(async () => {
    keydown({ key: "Enter", nativeEvent: { isComposing: false }, preventDefault });
    keydown({ key: "Enter", metaKey: true, nativeEvent: { isComposing: true }, preventDefault });
  });
  expect(conversation.onSend).not.toHaveBeenCalled();
  expect(preventDefault).not.toHaveBeenCalled();
  await act(async () =>
    keydown({
      key: "Enter",
      metaKey: true,
      repeat: true,
      nativeEvent: { isComposing: false },
      preventDefault,
    }),
  );
  expect(conversation.onSend).not.toHaveBeenCalled();
  await act(async () =>
    keydown({ key: "Enter", metaKey: true, nativeEvent: { isComposing: false }, preventDefault }),
  );
  expect(conversation.onSend).toHaveBeenCalledOnce();
});
