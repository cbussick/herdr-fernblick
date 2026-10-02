import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { Agent } from "../../shared/api/contracts";
import type { Snapshot } from "../../../packages/pi-live-chat/protocol";
import { AgentConsole } from "./AgentConsole";
import { ChatTranscript } from "./ChatTranscript";
import { ConversationTreeDialog } from "./ConversationTreeDialog";
import { Whiteboard } from "../whiteboard/Whiteboard";
import type { WhiteboardConversation } from "../whiteboard/ConversationDock";
const mocks = vi.hoisted(() => ({
  live: {} as { snapshot?: Snapshot; error?: string },
  command: vi.fn(),
  boardPrompt: vi.fn(),
  upload: vi.fn(),
}));
vi.mock("../whiteboard/boardApi", () => ({ boardApi: { prompt: mocks.boardPrompt } }));
vi.mock("./useLiveChat", () => ({ useLiveChat: () => mocks.live }));
vi.mock("./CloseTabButton", () => ({ CloseTabButton: () => null }));
vi.mock("./ConversationTreeDialog", () => ({ ConversationTreeDialog: () => null }));
vi.mock("../whiteboard/Whiteboard", () => ({ Whiteboard: () => null }));
vi.mock("../../shared/api/apiClient", () => ({
  chatCommand: mocks.command,
  uploadImage: mocks.upload,
  getAgentOutput: vi.fn(),
  sendAgentKey: vi.fn(),
}));
let renderer: ReactTestRenderer;
let client: QueryClient;
const agent = { agent: "pi", pane_id: "w1:p1", name: "test", agent_status: "idle" } as Agent;
function render() {
  return (
    <QueryClientProvider client={client}>
      <AgentConsole agent={agent} onBack={() => {}} />
    </QueryClientProvider>
  );
}
async function flush() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 15));
  });
}
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.live = {
    snapshot: {
      type: "snapshot",
      version: 2,
      capabilities: { boards: true },
      identity: {
        runtime: randomUUID(),
        pid: 1,
        processStart: "1",
        pane: "w1:p1",
        herdrSocket: "/test.sock",
        sessionId: "s",
        sessionFile: "/s.jsonl",
      },
      epoch: randomUUID(),
      seq: 1,
      busy: false,
      sendPending: false,
      truncated: false,
      messages: [],
      status: { cwd: "/", totalTokens: 0, cost: 0 },
    },
  };
  mocks.command.mockReset().mockImplementation(async (...args: unknown[]) => ({
    type: "ack",
    id: args[5] ?? randomUUID(),
    outcome: "invoked",
  }));
  mocks.boardPrompt.mockReset().mockResolvedValue({ type: "ack", outcome: "invoked" });
  mocks.upload.mockReset().mockResolvedValue({ id: `${randomUUID()}.png` });
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  await act(async () => {
    renderer = create(render());
  });
});
afterEach(async () => {
  await act(async () => renderer.unmount());
  client.clear();
  vi.unstubAllGlobals();
});
it("clears an acknowledged text-and-image send without waiting for any Pi event", async () => {
  const file = new File(["image"], "image.png", { type: "image/png" });
  await act(async () => {
    renderer.root.findByType("textarea").props.onChange({ target: { value: "hello" } });
    renderer.root.findByProps({ type: "file" }).props.onChange({ target: { files: [file] } });
  });
  await act(async () => renderer.root.findByType("form").props.onSubmit({ preventDefault() {} }));
  await flush();
  expect(mocks.command).toHaveBeenCalledOnce();
  expect(renderer.root.findByType("textarea").props.disabled).toBe(false);
  expect(renderer.root.findByType("textarea").props.value).toBe("");
  expect(renderer.root.findAllByProps({ "aria-label": "Image attachments" })).toHaveLength(0);
  expect(JSON.stringify(renderer.toJSON())).not.toContain("Clear draft / new message");
  expect(client.getMutationCache().getAll()).toHaveLength(0);
  mocks.live.snapshot = { ...mocks.live.snapshot!, seq: 3, busy: false };
  await act(async () => renderer.update(render()));
  await act(async () =>
    renderer.root.findByType("textarea").props.onChange({ target: { value: "next" } }),
  );
  expect(renderer.root.findByProps({ "aria-label": "Send message" }).props.disabled).toBe(false);
});
it("keeps an image-only draft when the forwarding ACK is lost", async () => {
  mocks.command.mockRejectedValue(new Error("Connection lost"));
  const file = new File(["image"], "image.png", { type: "image/png" });
  await act(async () =>
    renderer.root.findByProps({ type: "file" }).props.onChange({ target: { files: [file] } }),
  );
  await act(async () => renderer.root.findByType("form").props.onSubmit({ preventDefault() {} }));
  await flush();
  expect(renderer.root.findAllByProps({ "aria-label": "Image attachments" })).toHaveLength(1);
  expect(renderer.root.findByType("textarea").props.disabled).toBe(false);
  expect(JSON.stringify(renderer.toJSON())).toContain("Connection lost");
  expect(mocks.command).toHaveBeenCalledOnce();
});
it("does not erase a newer draft when Pi sends more chat updates", async () => {
  await act(async () =>
    renderer.root.findByType("textarea").props.onChange({ target: { value: "old" } }),
  );
  await act(async () => renderer.root.findByType("form").props.onSubmit({ preventDefault() {} }));
  await flush();
  await act(async () =>
    renderer.root.findByType("textarea").props.onChange({ target: { value: "new draft" } }),
  );
  mocks.live.snapshot = { ...mocks.live.snapshot!, seq: 2, busy: true };
  await act(async () => renderer.update(render()));
  expect(renderer.root.findByType("textarea").props.value).toBe("new draft");
});
it("preserves the conversation on a disconnect while disabling send and stop", async () => {
  mocks.live = {
    snapshot: {
      ...mocks.live.snapshot!,
      busy: true,
      messages: [{ id: "user", role: "user", text: "conversation stays" }],
    },
    error: "Reconnecting to Pi…",
  };
  await act(async () => renderer.update(render()));
  await act(async () =>
    renderer.root.findByType("textarea").props.onChange({ target: { value: "next" } }),
  );
  expect(JSON.stringify(renderer.toJSON())).toContain("conversation stays");
  expect(renderer.root.findByProps({ "aria-label": "Send message" }).props.disabled).toBe(true);
  const stop = renderer.root
    .findAllByType("button")
    .find((button) => button.children.includes("Stop"));
  expect(stop?.props.disabled).toBe(true);
});
it("preserves drafts and images through recovery without replaying commands", async () => {
  const file = new File(["image"], "image.png", { type: "image/png" });
  await act(async () => {
    renderer.root.findByType("textarea").props.onChange({ target: { value: "keep this draft" } });
    renderer.root.findByProps({ type: "file" }).props.onChange({ target: { files: [file] } });
  });
  mocks.live.error = "Reconnecting to Pi…";
  await act(async () => renderer.update(render()));
  expect(renderer.root.findByProps({ "aria-label": "Send message" }).props.disabled).toBe(true);
  expect(renderer.root.findByType("textarea").props.value).toBe("keep this draft");
  expect(renderer.root.findAllByProps({ "aria-label": "Image attachments" })).toHaveLength(1);
  delete mocks.live.error;
  await act(async () => renderer.update(render()));
  expect(renderer.root.findByProps({ "aria-label": "Send message" }).props.disabled).toBe(false);
  expect(renderer.root.findByType("textarea").props.value).toBe("keep this draft");
  expect(mocks.command).not.toHaveBeenCalled();
  expect(mocks.upload).not.toHaveBeenCalled();
});

it("never replays an uncertain in-flight send when the stream recovers", async () => {
  let fail!: (error: Error) => void;
  mocks.command.mockImplementationOnce(
    () =>
      new Promise((_resolve, reject) => {
        fail = reject;
      }),
  );
  await act(async () =>
    renderer.root.findByType("textarea").props.onChange({ target: { value: "uncertain send" } }),
  );
  await act(async () => renderer.root.findByType("form").props.onSubmit({ preventDefault() {} }));
  await flush();
  mocks.live.error = "Reconnecting to Pi…";
  await act(async () => renderer.update(render()));
  await act(async () => fail(new Error("Delivery uncertain")));
  await flush();
  delete mocks.live.error;
  await act(async () => renderer.update(render()));
  expect(mocks.command).toHaveBeenCalledOnce();
  expect(renderer.root.findByType("textarea").props.value).toBe("uncertain send");
  expect(renderer.root.findByType("textarea").props.disabled).toBe(false);
});

it("blocks an already-open tree during recovery and closes it on epoch replacement", async () => {
  const treeButton = renderer.root.findByProps({ "aria-label": "Open conversation paths" });
  await act(async () => treeButton.props.onClick());
  expect(renderer.root.findByType(ConversationTreeDialog).props.busy).toBe(false);
  mocks.live.error = "Reconnecting to Pi…";
  await act(async () => renderer.update(render()));
  expect(renderer.root.findByType(ConversationTreeDialog).props.busy).toBe(true);
  delete mocks.live.error;
  await act(async () => renderer.update(render()));
  expect(renderer.root.findByType(ConversationTreeDialog).props.busy).toBe(false);
  mocks.live.snapshot = { ...mocks.live.snapshot!, epoch: randomUUID() };
  await act(async () => renderer.update(render()));
  expect(renderer.root.findAllByType(ConversationTreeDialog)).toHaveLength(0);
  expect(mocks.command).not.toHaveBeenCalled();
});

it("keeps the chat draft mounted through whiteboard Back and disconnects", async () => {
  await act(async () =>
    renderer.root.findByType("textarea").props.onChange({ target: { value: "chat draft stays" } }),
  );
  await act(async () =>
    renderer.root.findByProps({ "aria-label": "Open whiteboard" }).props.onClick(),
  );
  expect(renderer.root.findByType(Whiteboard).props.structured).toBe(true);
  expect(renderer.root.findByType("textarea").props.value).toBe("chat draft stays");
  mocks.live.error = "Reconnecting…";
  await act(async () => renderer.update(render()));
  expect(renderer.root.findByType(Whiteboard).props.agentState).toBe("disconnected");
  await act(async () => renderer.root.findByType(Whiteboard).props.onClose());
  expect(renderer.root.findByType("textarea").props.value).toBe("chat draft stays");
  expect(mocks.command).not.toHaveBeenCalled();
});

it("keeps the captured board through a missing live snapshot and same-session recovery", async () => {
  const initial = mocks.live.snapshot!;
  await act(async () =>
    renderer.root.findByProps({ "aria-label": "Open whiteboard" }).props.onClick(),
  );
  const captured = renderer.root.findByType(Whiteboard).props.target;
  // A transport-level unavailable frame removes the live snapshot. It does not
  // establish that the conversation or Pi runtime has actually been replaced.
  mocks.live = { error: "Temporarily unavailable" };
  await act(async () => renderer.update(render()));
  expect(renderer.root.findAllByType(Whiteboard)).toHaveLength(1);
  expect(renderer.root.findByType(Whiteboard).props.agentState).toBe("disconnected");
  expect(renderer.root.findByType(Whiteboard).props.target).toBe(captured);
  for (const state of [
    { seq: 2, sendPending: true, busy: false },
    { seq: 3, sendPending: false, busy: true },
    { seq: 4, sendPending: false, busy: false },
  ]) {
    mocks.live = { snapshot: { ...initial, ...state } };
    await act(async () => renderer.update(render()));
    expect(renderer.root.findByType(Whiteboard).props.target).toBe(captured);
    expect(renderer.root.findByType(Whiteboard).props.agentState).toBe(
      state.sendPending ? "waiting" : state.busy ? "working" : "ready",
    );
  }
  expect(mocks.command).not.toHaveBeenCalled();
  expect(mocks.upload).not.toHaveBeenCalled();
});

it.each(["epoch", "runtime", "sessionId"] as const)(
  "still closes the old board when recovery confirms a different %s",
  async (field) => {
    const initial = mocks.live.snapshot!;
    await act(async () =>
      renderer.root.findByProps({ "aria-label": "Open whiteboard" }).props.onClick(),
    );
    mocks.live = { error: "Temporarily unavailable" };
    await act(async () => renderer.update(render()));
    expect(renderer.root.findAllByType(Whiteboard)).toHaveLength(1);
    const replacement =
      field === "epoch"
        ? { ...initial, epoch: randomUUID() }
        : { ...initial, identity: { ...initial.identity, [field]: randomUUID() } };
    mocks.live = { snapshot: replacement };
    await act(async () => renderer.update(render()));
    expect(renderer.root.findAllByType(Whiteboard)).toHaveLength(0);
    expect(mocks.command).not.toHaveBeenCalled();
  },
);

async function openBoard() {
  await act(async () =>
    renderer.root.findByProps({ "aria-label": "Open whiteboard" }).props.onClick(),
  );
}
function boardConversation(): WhiteboardConversation {
  return renderer.root.findByType(Whiteboard).props.conversation;
}
it("supplies the same conversation and thinking preference to main chat and whiteboard", async () => {
  mocks.live.snapshot = {
    ...mocks.live.snapshot!,
    messages: [
      { id: "u", role: "user", text: "Earlier question" },
      { id: "a", role: "assistant", text: "Earlier answer" },
      { id: "t", role: "tool", toolName: "board_read", text: "Read the scene" },
    ],
    truncated: true,
  };
  await act(async () => renderer.update(render()));
  await openBoard();
  const main = renderer.root.findByType(ChatTranscript);
  expect(main.props.messages).toBe(boardConversation().snapshot!.messages);
  expect(main.props.truncated).toBe(boardConversation().snapshot!.truncated);
  expect(main.props.showThinking).toBe(boardConversation().showThinking);
  expect(main.props.agentName).toBe(boardConversation().agentName);
});
it("shares the text draft and live conversation but never sends hidden chat images from the board", async () => {
  const file = new File(["image"], "image.png", { type: "image/png" });
  await act(async () => {
    renderer.root
      .findByType("textarea")
      .props.onChange({ target: { value: "Existing chat draft" } });
    renderer.root.findByProps({ type: "file" }).props.onChange({ target: { files: [file] } });
  });
  await openBoard();
  expect(boardConversation().draft).toBe("Existing chat draft");
  expect(boardConversation().snapshot).toBe(mocks.live.snapshot);
  await act(async () => boardConversation().onDraftChange("Finish the handwriting"));
  expect(renderer.root.findByType("textarea").props.value).toBe("Finish the handwriting");
  await act(async () =>
    boardConversation().onSend({
      boardId: "a".repeat(64),
      revision: 1,
      text: boardConversation().draft,
      uploadId: "33333333-3333-4333-8333-333333333333.png",
    }),
  );
  await flush();
  expect(mocks.boardPrompt).toHaveBeenCalledOnce();
  expect(mocks.boardPrompt.mock.calls[0][1]).toMatchObject({
    text: "Finish the handwriting",
    uploadId: "33333333-3333-4333-8333-333333333333.png",
    boardId: "a".repeat(64),
    revision: 1,
  });
  expect(mocks.command).not.toHaveBeenCalled();
  expect(mocks.upload).not.toHaveBeenCalled();
  expect(boardConversation().draft).toBe("");
  expect(renderer.root.findAllByProps({ "aria-label": "Image attachments" })).toHaveLength(1);
});
it("retains uncertain dock text and its error across Back/reopen and reconnect without replay", async () => {
  mocks.boardPrompt.mockRejectedValueOnce(new Error("Delivery uncertain"));
  await openBoard();
  await act(async () => boardConversation().onDraftChange("Keep this question"));
  await act(async () =>
    boardConversation().onSend({
      boardId: "a".repeat(64),
      revision: 1,
      text: boardConversation().draft,
    }),
  );
  await flush();
  expect(boardConversation().draft).toBe("Keep this question");
  expect(boardConversation().error).toContain("Delivery uncertain");
  mocks.live.error = "Reconnecting";
  await act(async () => renderer.update(render()));
  delete mocks.live.error;
  await act(async () => renderer.update(render()));
  await act(async () => renderer.root.findByType(Whiteboard).props.onClose());
  await openBoard();
  expect(boardConversation().draft).toBe("Keep this question");
  expect(boardConversation().error).toContain("Draft retained");
  expect(mocks.boardPrompt).toHaveBeenCalledOnce();
});
it("locks dock submissions synchronously against duplicate taps or shortcuts", async () => {
  await openBoard();
  await act(async () => boardConversation().onDraftChange("Send exactly once"));
  const submit = boardConversation().onSend;
  await act(async () => {
    submit({ boardId: "a".repeat(64), revision: 1, text: "Send exactly once" });
    submit({ boardId: "a".repeat(64), revision: 1, text: "Send exactly once" });
  });
  await flush();
  expect(mocks.boardPrompt).toHaveBeenCalledOnce();
});
it.each([
  "busy",
  "pending",
  "disconnected",
  "missing",
  "legacy",
  "closed",
  "epoch",
  "runtime",
  "sessionId",
])("revalidates a captured dock send against %s state", async (state) => {
  await openBoard();
  await act(async () => boardConversation().onDraftChange("Do not send stale text"));
  const submit = boardConversation().onSend;
  if (state === "closed")
    await act(async () => renderer.root.findByType(Whiteboard).props.onClose());
  else if (state === "disconnected") mocks.live.error = "Reconnecting";
  else if (state === "missing") mocks.live = { error: "Unavailable" };
  else if (state === "busy") mocks.live.snapshot = { ...mocks.live.snapshot!, busy: true };
  else if (state === "pending")
    mocks.live.snapshot = { ...mocks.live.snapshot!, sendPending: true };
  else if (state === "legacy") mocks.live.snapshot = { ...mocks.live.snapshot!, version: 1 };
  else if (state === "epoch")
    mocks.live.snapshot = { ...mocks.live.snapshot!, epoch: randomUUID() };
  else
    mocks.live.snapshot = {
      ...mocks.live.snapshot!,
      identity: { ...mocks.live.snapshot!.identity, [state]: randomUUID() },
    };
  await act(async () => renderer.update(render()));
  await act(async () =>
    submit({ boardId: "a".repeat(64), revision: 1, text: "Do not send stale text" }),
  );
  await flush();
  expect(mocks.boardPrompt).not.toHaveBeenCalled();
  expect(mocks.upload).not.toHaveBeenCalled();
});
it("does not clear a replacement session's draft when an old dock send is acknowledged", async () => {
  let resolve!: (value: unknown) => void;
  mocks.boardPrompt.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  await openBoard();
  await act(async () => boardConversation().onDraftChange("Identical text in another session"));
  await act(async () =>
    boardConversation().onSend({
      boardId: "a".repeat(64),
      revision: 1,
      text: boardConversation().draft,
    }),
  );
  await flush();
  mocks.live.snapshot = { ...mocks.live.snapshot!, epoch: randomUUID() };
  await act(async () => renderer.update(render()));
  expect(renderer.root.findAllByType(Whiteboard)).toHaveLength(0);
  await act(async () => resolve({ type: "ack", outcome: "invoked" }));
  await flush();
  expect(renderer.root.findByType("textarea").props.value).toBe(
    "Identical text in another session",
  );
  expect(mocks.boardPrompt).toHaveBeenCalledOnce();
});

it("requires reloading a legacy extension instead of accepting an unconfirmable send", async () => {
  mocks.live.snapshot = { ...mocks.live.snapshot!, version: 1 };
  await act(async () => renderer.update(render()));
  await act(async () =>
    renderer.root.findByType("textarea").props.onChange({ target: { value: "message" } }),
  );
  expect(renderer.root.findByProps({ "aria-label": "Send message" }).props.disabled).toBe(true);
  expect(JSON.stringify(renderer.toJSON())).toContain("Run /reload in Pi");
});
it("keeps an unacknowledged draft across a Pi restart", async () => {
  let failForward!: (error: Error) => void;
  mocks.command.mockImplementationOnce(
    () =>
      new Promise((_done, reject) => {
        failForward = reject;
      }),
  );
  await act(async () =>
    renderer.root.findByType("textarea").props.onChange({ target: { value: "original draft" } }),
  );
  await act(async () => renderer.root.findByType("form").props.onSubmit({ preventDefault() {} }));
  await flush();
  mocks.live.snapshot = {
    ...mocks.live.snapshot!,
    identity: { ...mocks.live.snapshot!.identity, runtime: randomUUID() },
  };
  await act(async () => renderer.update(render()));
  await act(async () => failForward(new Error("Pi connection lost; delivery uncertain")));
  await flush();
  expect(renderer.root.findByType("textarea").props.value).toBe("original draft");
  expect(renderer.root.findByType("textarea").props.disabled).toBe(false);
});
it("locks the composer only through upload and forwarding, then uses Pi busy/idle to gate sending", async () => {
  let acknowledge!: (value: { type: string; id: string; outcome: string }) => void;
  mocks.command.mockImplementationOnce(
    () =>
      new Promise((done) => {
        acknowledge = done;
      }),
  );
  let finishUpload!: (value: { id: string }) => void;
  mocks.upload.mockImplementationOnce(
    () =>
      new Promise((done) => {
        finishUpload = done;
      }),
  );
  const file = new File(["image"], "image.png", { type: "image/png" });
  await act(async () => {
    renderer.root.findByType("textarea").props.onChange({ target: { value: "hello" } });
    renderer.root.findByProps({ type: "file" }).props.onChange({ target: { files: [file] } });
  });
  await act(async () => renderer.root.findByType("form").props.onSubmit({ preventDefault() {} }));
  await flush();
  const assertWaiting = () => {
    const form = renderer.root.findByType("form");
    expect(form.props["aria-busy"]).toBe(true);
    for (const button of form.findAllByType("button")) expect(button.props.disabled).toBe(true);
    expect(form.findByType("textarea").props.disabled).toBe(true);
    expect(form.findByProps({ type: "file" }).props.disabled).toBe(true);
    expect(form.findAllByProps({ "data-testid": "send-spinner" })).toHaveLength(1);
    expect(JSON.stringify(renderer.toJSON())).not.toContain("Waiting for Pi to receive");
    expect(JSON.stringify(renderer.toJSON())).not.toContain("Sending to Pi");
  };
  assertWaiting();
  expect(mocks.command).not.toHaveBeenCalled();
  await act(async () => finishUpload({ id: `${randomUUID()}.png` }));
  await flush();
  mocks.live.snapshot = { ...mocks.live.snapshot!, seq: 2, sendPending: true };
  await act(async () => renderer.update(render()));
  assertWaiting();
  const id = mocks.command.mock.calls[0][5];
  await act(async () => acknowledge({ type: "ack", id, outcome: "invoked" }));
  await flush();
  mocks.live.snapshot = { ...mocks.live.snapshot!, seq: 3, busy: true, sendPending: false };
  await act(async () => renderer.update(render()));
  expect(renderer.root.findByType("form").props["aria-busy"]).toBe(false);
  expect(renderer.root.findByType("textarea").props.disabled).toBe(false);
  expect(renderer.root.findByProps({ type: "file" }).props.disabled).toBe(false);
  expect(renderer.root.findByProps({ "aria-label": "Attach images" }).props.disabled).toBe(false);
  expect(renderer.root.findAllByProps({ "data-testid": "send-spinner" })).toHaveLength(0);
  expect(renderer.root.findByProps({ "aria-label": "Send message" }).props.disabled).toBe(true);
});
it("styles the whiteboard entry like the adjacent conversation-paths action", () => {
  const board = renderer.root.findByProps({ "aria-label": "Open whiteboard" });
  const paths = renderer.root.findByProps({ "aria-label": "Open conversation paths" });
  expect(board.props.className).toBe(paths.props.className);
  const icon = board.findByType("svg");
  expect(icon.props.strokeWidth).toBe("2");
  expect(icon.props.width).toBeUndefined();
  expect(icon.props.height).toBeUndefined();
});
it("shows a starting placeholder instead of an unknown/error state before Pi is ready", async () => {
  mocks.live = {};
  await act(async () => renderer.update(render()));
  const state = renderer.root.findByProps({ role: "status" });
  expect(state.props["aria-busy"]).toBe("true");
  expect(state.findByProps({ "data-state-kind": "loading" }).props["data-spinning"]).toBe(true);
  expect(JSON.stringify(renderer.toJSON())).toContain("Starting Pi…");
  expect(renderer.root.findAllByProps({ role: "alert" })).toHaveLength(0);
  expect(renderer.root.findByProps({ "aria-label": "Send message" }).props.disabled).toBe(true);
});
it("preserves text and attachments when forwarding fails", async () => {
  mocks.command.mockRejectedValue(new Error("Connection lost"));
  const file = new File(["image"], "image.png", { type: "image/png" });
  await act(async () => {
    renderer.root.findByType("textarea").props.onChange({ target: { value: "keep me" } });
    renderer.root.findByProps({ type: "file" }).props.onChange({ target: { files: [file] } });
  });
  await act(async () => renderer.root.findByType("form").props.onSubmit({ preventDefault() {} }));
  await flush();
  expect(renderer.root.findByType("textarea").props.value).toBe("keep me");
  expect(renderer.root.findAllByProps({ "aria-label": "Image attachments" })).toHaveLength(1);
  expect(mocks.command).toHaveBeenCalledOnce();
  expect(renderer.root.findByType("textarea").props.disabled).toBe(false);
  expect(renderer.root.findByProps({ "aria-label": "Attach images" }).props.disabled).toBe(false);
  expect(renderer.root.findAllByProps({ "data-testid": "send-spinner" })).toHaveLength(0);
});

it("shows a decorative icon in connecting and unavailable chat placeholders", async () => {
  mocks.live = {};
  await act(async () => renderer.update(render()));
  expect(
    renderer.root.findByProps({ "data-state-kind": "loading" }).findByType("svg").props[
      "aria-hidden"
    ],
  ).toBe("true");
  mocks.live = { error: "Cannot reach Pi" };
  await act(async () => renderer.update(render()));
  expect(renderer.root.findByProps({ role: "alert" }).findByType("svg").props["aria-hidden"]).toBe(
    "true",
  );
  expect(JSON.stringify(renderer.toJSON())).toContain("Cannot reach Pi");
});

it("does not render obsolete sending or receipt notices for a backend handoff", async () => {
  mocks.live.snapshot = { ...mocks.live.snapshot!, sendPending: true };
  await act(async () => renderer.update(render()));
  expect(JSON.stringify(renderer.toJSON())).not.toContain("Sending to Pi");
  expect(JSON.stringify(renderer.toJSON())).not.toContain("Waiting for Pi");
  expect(renderer.root.findByProps({ "aria-label": "Send message" }).props.disabled).toBe(true);
});

it("clears the acknowledged draft without requiring a Pi receipt", async () => {
  await act(async () =>
    renderer.root.findByType("textarea").props.onChange({ target: { value: "clear on ACK" } }),
  );
  await act(async () => renderer.root.findByType("form").props.onSubmit({ preventDefault() {} }));
  await flush();
  expect(renderer.root.findByType("textarea").props.value).toBe("");
  expect(renderer.root.findAllByProps({ "data-testid": "send-spinner" })).toHaveLength(0);
  expect(JSON.stringify(renderer.toJSON())).not.toContain("Waiting for Pi");
});
