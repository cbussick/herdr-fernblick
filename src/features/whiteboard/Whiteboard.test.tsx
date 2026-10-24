import { act, type ReactNode } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Whiteboard, type WhiteboardProps } from "./Whiteboard";
import type { BoardEditorProps } from "./BoardEditor";
import type { BoardState } from "../../../packages/pi-live-chat/boardProtocol";
import { board, deferred, target } from "./testFixtures";

const mocks = vi.hoisted(() => ({
  open: vi.fn(),
  save: vi.fn(),
  revoke: vi.fn(),
  close: vi.fn(),
  events: vi.fn(),
  upload: vi.fn(),
  fit: vi.fn(),
}));
vi.mock("react-dom", () => ({ createPortal: (children: ReactNode) => children }));
vi.mock("./boardApi", () => ({
  boardApi: { open: mocks.open, save: mocks.save, revoke: mocks.revoke, events: mocks.events },
}));
vi.mock("./draftStore", () => ({
  draftStore: { read: async () => undefined, write: async () => {} },
}));
vi.mock("../../shared/api/apiClient", () => ({ uploadImage: mocks.upload }));
vi.mock("./BoardEditor", async () => {
  const { useEffect, useState } = await import("react");
  return {
    default: function MockEditor(props: BoardEditorProps) {
      const [onReady] = useState(() => props.onReady);
      useEffect(() => {
        onReady({ fit: mocks.fit });
        return () => onReady(null);
      }, [onReady]);
      return null;
    },
  };
});
let renderer: ReactTestRenderer;
let props: WhiteboardProps;
async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
}
function button(label: string) {
  return renderer.root.findAllByType("button").find((item) => item.children.includes(label))!;
}
function form() {
  return renderer.root.findByProps({ "aria-label": "Message from whiteboard" });
}
function editor() {
  return renderer.root.findAll(
    (node) => typeof node.type === "function" && node.type.name === "MockEditor",
  )[0];
}
async function updateAccess(access: BoardState["access"]) {
  mocks.open.mockResolvedValue({ ...board(), access });
  await act(async () =>
    mocks.events.mock.lastCall![2]({ type: "changed", revision: 1, access, lastAuthor: "human" }),
  );
  await flush();
}
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("window", {});
  vi.stubGlobal("document", { activeElement: null });
  vi.stubGlobal("HTMLElement", class {});
  vi.clearAllMocks();
  mocks.open.mockResolvedValue(board());
  mocks.events.mockReturnValue(mocks.close);
  mocks.save.mockResolvedValue(board(2));
  mocks.revoke.mockResolvedValue({ ok: true });
  props = {
    pane: "pane",
    agentName: "Planner",
    agentContext: "FeBO · Orchestrator",
    target,
    agentState: "ready",
    structured: true,
    onClose: vi.fn(),
    conversation: {
      showThinking: false,
      snapshot: { messages: [], truncated: false },
      draft: "",
      sending: false,
      onDraftChange: vi.fn(),
      onSend: vi.fn(),
    },
  };
  await act(async () => {
    renderer = create(<Whiteboard {...props} />);
  });
  await flush();
});
afterEach(async () => {
  await act(async () => renderer.unmount());
  vi.unstubAllGlobals();
});
it("identifies the agent and removes sharing, history and repeated permission explanations", async () => {
  await updateAccess({ mode: "edit", state: "active", expiresAt: Date.now() + 60000 });
  const output = JSON.stringify(renderer.toJSON());
  expect(output).toContain("Planner");
  expect(output).toContain("FeBO · Orchestrator");
  for (const copy of ["Share drawing", "Saved snapshots", "Agent can edit", "Prompts send"])
    expect(output).not.toContain(copy);
  expect(button("Stop access")).toBeDefined();
});
it("uses Working without repeating the agent name", async () => {
  await act(async () => renderer.update(<Whiteboard {...props} agentState="working" />));
  const activity = renderer.root.findByProps({ "data-testid": "whiteboard-activity" });
  expect(activity.findByProps({ label: "Working" })).toBeDefined();
  expect(JSON.stringify(renderer.toJSON())).not.toContain("Planner working");
});
it("fits the drawing only when requested", async () => {
  expect(mocks.fit).not.toHaveBeenCalled();
  await act(async () => button("Fit drawing").props.onClick());
  expect(mocks.fit).toHaveBeenCalledOnce();
});
it("resolves dock images against the retained Pi cwd while live chat reconnects", async () => {
  props.conversation.snapshot = {
    messages: [{ id: "a", role: "assistant", text: "![Preview](./preview.png)" }],
    truncated: false,
    status: { cwd: "/workspace/board" },
  };
  await act(async () => renderer.update(<Whiteboard {...props} />));
  const src = "/api/local-images?path=%2Fworkspace%2Fboard%2F.%2Fpreview.png";
  expect(renderer.root.findByProps({ alt: "Preview" }).props.src).toBe(src);
  props.conversation.snapshot = undefined;
  await act(async () => renderer.update(<Whiteboard {...props} />));
  expect(renderer.root.findByProps({ alt: "Preview" }).props.src).toBe(src);
});
it.each(["nonempty", "empty", "deleted"])(
  "forwards a %s board prompt without exporting/uploading an automatic image",
  async (kind) => {
    const state = board(2);
    if (kind === "empty") state.scene.elements = [];
    if (kind === "deleted") state.scene.elements[0].isDeleted = true;
    mocks.open.mockResolvedValue(state);
    await act(async () =>
      mocks.events.mock.lastCall![2]({
        type: "changed",
        revision: 2,
        access: null,
        lastAuthor: "human",
      }),
    );
    await flush();
    props.conversation.draft = "Draw an elephant";
    await act(async () => renderer.update(<Whiteboard {...props} />));
    await act(async () => form().props.onSubmit({ preventDefault() {} }));
    await flush();
    expect(props.conversation.onSend).toHaveBeenCalledWith({
      boardId: state.id,
      revision: 2,
      text: "Draw an elephant",
    });
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(props.onClose).not.toHaveBeenCalled();
  },
);
it("flushes manual changes before forwarding and prevents double submission", async () => {
  props.conversation.draft = "Draw";
  await act(async () => renderer.update(<Whiteboard {...props} />));
  await act(async () => editor().props.onChange(board(2).scene));
  await act(async () => {
    form().props.onSubmit({ preventDefault() {} });
    form().props.onSubmit({ preventDefault() {} });
  });
  await flush();
  expect(mocks.save).toHaveBeenCalledOnce();
  expect(props.conversation.onSend).toHaveBeenCalledOnce();
  expect(props.conversation.onSend).toHaveBeenCalledWith(expect.objectContaining({ revision: 2 }));
});
it("retains a draft and does not forward when flushing fails", async () => {
  props.conversation.draft = "Keep this question";
  mocks.save.mockRejectedValueOnce(new Error("Save failed"));
  await act(async () => renderer.update(<Whiteboard {...props} />));
  await act(async () => editor().props.onChange(board(2).scene));
  await act(async () => form().props.onSubmit({ preventDefault() {} }));
  await flush();
  expect(props.conversation.onSend).not.toHaveBeenCalled();
  expect(props.conversation.onDraftChange).not.toHaveBeenCalled();
  expect(JSON.stringify(renderer.toJSON())).toContain("Draft retained");
});
it.each(["unmount", "busy", "unsupported", "disconnected", "invalid scene"])(
  "revalidates after %s during a pending save",
  async (change) => {
    props.conversation.draft = "Finish this";
    const saved = deferred<BoardState>();
    mocks.save.mockReturnValueOnce(saved.promise);
    await act(async () => renderer.update(<Whiteboard {...props} />));
    await act(async () => editor().props.onChange(board(2).scene));
    await act(async () => form().props.onSubmit({ preventDefault() {} }));
    expect(editor().props.locked).toBe(true);
    if (change === "unmount") await act(async () => renderer.unmount());
    else if (change === "disconnected") await act(async () => mocks.events.mock.lastCall![3]());
    else if (change === "invalid scene")
      await act(async () => editor().props.onError("Unsupported drawing"));
    else
      await act(async () =>
        renderer.update(
          <Whiteboard
            {...props}
            agentState={change === "busy" ? "working" : "ready"}
            structured={change !== "unsupported"}
          />,
        ),
      );
    await act(async () => saved.resolve(board(2)));
    await flush();
    expect(props.conversation.onSend).not.toHaveBeenCalled();
  },
);
it("blocks sending while busy or without board capability", async () => {
  props.conversation.draft = "Draw";
  await act(async () => renderer.update(<Whiteboard {...props} agentState="working" />));
  expect(button("Send").props.disabled).toBe(true);
  await act(async () => form().props.onSubmit({ preventDefault() {} }));
  await act(async () => renderer.update(<Whiteboard {...props} structured={false} />));
  expect(button("Send").props.disabled).toBe(true);
  expect(JSON.stringify(renderer.toJSON())).toContain("Run /reload in Pi");
  expect(props.conversation.onSend).not.toHaveBeenCalled();
});
it("preserves drafts and exposes reconnect when the board disconnects", async () => {
  props.conversation.draft = "Draw";
  await act(async () => renderer.update(<Whiteboard {...props} />));
  await act(async () => mocks.events.mock.lastCall![3]());
  expect(button("Send").props.disabled).toBe(true);
  expect(button("Reconnect board")).toBeDefined();
  expect(props.onClose).not.toHaveBeenCalled();
});
it("keeps failed revocation visible without claiming access ended", async () => {
  await updateAccess({ mode: "edit", state: "active", expiresAt: Date.now() + 60000 });
  mocks.revoke.mockRejectedValueOnce(new Error("Could not revoke access"));
  await act(async () => button("Stop access").props.onClick());
  await flush();
  expect(renderer.root.findAllByProps({ role: "alert" })).toHaveLength(1);
  expect(button("Stop access").props.disabled).toBe(false);
});
it("returning to chat or closing the view never revokes ongoing board access", async () => {
  await updateAccess({ mode: "edit", state: "active", expiresAt: Date.now() + 60000 });
  await act(async () => button("← Back").props.onClick());
  expect(props.onClose).toHaveBeenCalledOnce();
  await act(async () => renderer.unmount());
  expect(mocks.revoke).not.toHaveBeenCalled();
});
