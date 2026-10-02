import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ConversationDock, type WhiteboardConversation } from "./ConversationDock";
import { StatusIndicator } from "../../shared/ui";
import { ChatTranscript } from "../agents/ChatTranscript";

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
function toggle() {
  return renderer.root.findByProps({ "aria-controls": "whiteboard-conversation-messages" });
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
it("uses the main chat transcript with all available turns and tool results even when compact", () => {
  expect(text()).toContain("First response");
  expect(text()).toContain("Final response");
  expect(text()).toContain("Old question");
  expect(text()).toContain("Old reply");
  expect(text()).toContain("Tool failure");
  expect(text()).not.toContain("Private thought");
  expect(renderer.root.findByType(ChatTranscript).props.messages).toBe(
    conversation.snapshot!.messages,
  );
  expect(renderer.root.findByType(ChatTranscript).props.showThinking).toBe(false);
  expect(renderer.root.findAllByProps({ role: "status" })).toHaveLength(1);
  expect(text()).toContain("Reply ready");
});
it("uses the shared working indicator and replaces it with warnings or settled reply status", async () => {
  activity.working = true;
  await act(async () => renderer.update(render()));
  expect(renderer.root.findByType(StatusIndicator).props.status).toBe("working");
  expect(renderer.root.findByType(StatusIndicator).props.label).toBe("Agent is working");
  activity.warning = true;
  activity.message = "Connection lost";
  await act(async () => renderer.update(render(true)));
  expect(renderer.root.findAllByType(StatusIndicator)).toHaveLength(0);
  expect(text()).toContain("Connection lost");
  activity.working = false;
  activity.warning = false;
  activity.message = "";
  await act(async () => renderer.update(render()));
  expect(renderer.root.findAllByType(StatusIndicator)).toHaveLength(0);
  expect(text()).toContain("Reply ready");
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
it("expands only layout, preserves the shared transcript, respects thinking preference, and collapses with Escape", async () => {
  const messages = renderer.root.findByType(ChatTranscript).props.messages;
  await act(async () => toggle().props.onClick());
  expect(renderer.root.findByType(ChatTranscript).props.messages).toBe(messages);
  expect(toggle().props["aria-expanded"]).toBe(true);
  expect(text()).toMatch(/Old question/);
  expect(text()).toMatch(/Tool failure/);
  expect(text()).toMatch(/Saved snapshots/);
  expect(text()).not.toContain("Private thought");
  conversation.showThinking = true;
  await act(async () => renderer.update(render()));
  expect(text()).toContain("Private thought");
  const preventDefault = vi.fn();
  const stopPropagation = vi.fn();
  await act(async () =>
    renderer.root.findByType("section").props.onKeyDown({
      key: "Escape",
      nativeEvent: { isComposing: false },
      preventDefault,
      stopPropagation,
    }),
  );
  expect(preventDefault).toHaveBeenCalledOnce();
  expect(stopPropagation).toHaveBeenCalledOnce();
  expect(toggle().props["aria-expanded"]).toBe(false);
  expect(renderer.root.findByType(ChatTranscript).props.messages).toBe(messages);
  expect(text()).toContain("Old reply");
  expect(text()).toContain("Private thought");
});
it("uses a controlled, text-only composer without attachment or tool actions", async () => {
  const input = renderer.root.findByType("textarea");
  expect(input.props.maxLength).toBe(29000);
  await act(async () => input.props.onChange({ target: { value: "New draft" } }));
  expect(conversation.onDraftChange).toHaveBeenCalledWith("New draft");
  expect(renderer.root.findAllByType("input")).toHaveLength(0);
  expect(renderer.root.findAllByType("button")).toHaveLength(2); // Expand + Send.
  conversation.draft = "New draft";
  await act(async () => renderer.update(render()));
  await act(async () => renderer.root.findByType("form").props.onSubmit({ preventDefault() {} }));
  expect(conversation.onSend).toHaveBeenCalledOnce();
});
it.each(["empty", "disabled", "inert", "sending"])(
  "blocks %s submissions, including keyboard shortcuts",
  async (reason) => {
    conversation.draft = reason === "empty" ? "  " : "A question";
    conversation.sending = reason === "sending";
    await act(async () => renderer.update(render(reason === "disabled", reason === "inert")));
    await act(async () => {
      renderer.root.findByType("form").props.onSubmit({ preventDefault() {} });
      renderer.root.findByType("textarea").props.onKeyDown({
        key: "Enter",
        ctrlKey: true,
        nativeEvent: { isComposing: false },
        preventDefault() {},
      });
    });
    expect(conversation.onSend).not.toHaveBeenCalled();
  },
);
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
