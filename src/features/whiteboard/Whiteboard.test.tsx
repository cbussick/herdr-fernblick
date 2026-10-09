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
  send: vi.fn(),
  revoke: vi.fn(),
  close: vi.fn(),
  events: vi.fn(),
  upload: vi.fn(),
  exportPNG: vi.fn(),
}));
vi.mock("react-dom", () => ({ createPortal: (children: ReactNode) => children }));
vi.mock("./boardApi", () => ({
  requestId: () => "33333333-3333-4333-8333-333333333333",
  boardApi: {
    open: mocks.open,
    save: mocks.save,
    send: mocks.send,
    revoke: mocks.revoke,
    events: mocks.events,
  },
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
        onReady({ exportPNG: mocks.exportPNG });
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
async function openSheet() {
  await act(async () => button("Share drawing").props.onClick());
  await flush();
}
function form() {
  return renderer.root.findByProps({ "aria-label": "Message from whiteboard" });
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
  mocks.send.mockResolvedValue({ type: "ack", outcome: "invoked" });
  mocks.revoke.mockResolvedValue({ ok: true });
  mocks.upload.mockResolvedValue({ id: "33333333-3333-4333-8333-333333333333.png" });
  mocks.exportPNG.mockResolvedValue(new Blob(["png"], { type: "image/png" }));
  props = {
    pane: "pane",
    target,
    agentState: "ready",
    structured: true,
    onClose: vi.fn(),
    conversation: {
      agentName: "Pi",
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
it("retains a failed image instruction and never automatically retries", async () => {
  await openSheet();
  await act(async () =>
    renderer.root
      .findByProps({ placeholder: "What should the agent do with this drawing?" })
      .props.onChange({ target: { value: "Keep this instruction" } }),
  );
  mocks.send.mockRejectedValueOnce(new Error("Delivery uncertain"));
  await act(async () => button("Send drawing").props.onClick());
  await flush();
  expect(
    renderer.root.findByProps({ placeholder: "What should the agent do with this drawing?" }).props
      .value,
  ).toBe("Keep this instruction");
  expect(mocks.send).toHaveBeenCalledOnce();
});
it.each(["empty", "deleted"])("dock prompts skip image export for a %s board", async (kind) => {
  props.conversation.draft = "Draw an elephant";
  mocks.open.mockResolvedValue({
    ...board(2),
    scene: {
      elements: kind === "empty" ? [] : [{ ...board().scene.elements[0], isDeleted: true }],
      files: {},
      background: "#ffffff",
    },
  });
  await act(async () =>
    mocks.events.mock.lastCall![2]({
      type: "changed",
      revision: 2,
      access: null,
      lastAuthor: "human",
    }),
  );
  await flush();
  await act(async () => renderer.update(<Whiteboard {...props} />));
  await act(async () => form().props.onSubmit({ preventDefault() {} }));
  await flush();
  expect(props.conversation.onSend).toHaveBeenCalledWith({
    boardId: board().id,
    revision: 2,
    text: "Draw an elephant",
  });
  expect(mocks.exportPNG).not.toHaveBeenCalled();
  expect(mocks.upload).not.toHaveBeenCalled();
  expect(mocks.send).not.toHaveBeenCalled();
  expect(JSON.stringify(renderer.toJSON())).toContain("Prompts send the drawing and allow edits.");
});
it("dock prompts export and upload handwriting with board context, not a saved snapshot", async () => {
  props.conversation.draft = "Finish the handwritten sentence";
  const state = board(2);
  state.scene.elements[0] = {
    ...state.scene.elements[0],
    type: "freedraw",
    points: [
      [0, 0],
      [10, 20],
    ],
  };
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
  await act(async () => renderer.update(<Whiteboard {...props} />));
  await act(async () => form().props.onSubmit({ preventDefault() {} }));
  await flush();
  expect(mocks.exportPNG).toHaveBeenCalledOnce();
  expect(mocks.upload).toHaveBeenCalledOnce();
  expect(mocks.upload.mock.calls[0][0]).toMatchObject({
    name: "whiteboard.png",
    type: "image/png",
  });
  expect(props.conversation.onSend).toHaveBeenCalledWith({
    boardId: state.id,
    revision: 2,
    text: "Finish the handwritten sentence",
    uploadId: "33333333-3333-4333-8333-333333333333.png",
  });
  expect(mocks.send).not.toHaveBeenCalled();
  expect(props.onClose).not.toHaveBeenCalled();
});
it("flushes human changes before forwarding a dock prompt and prevents double submits", async () => {
  props.conversation.draft = "Draw";
  await act(async () => renderer.update(<Whiteboard {...props} />));
  // Exercise the actual controller through the editor onChange seam.
  const editor = renderer.root.findAll(
    (node) => typeof node.type === "function" && node.type.name === "MockEditor",
  )[0];
  await act(async () => editor.props.onChange(board(2).scene));
  await act(async () => {
    form().props.onSubmit({ preventDefault() {} });
    form().props.onSubmit({ preventDefault() {} });
  });
  await flush();
  expect(mocks.save).toHaveBeenCalledOnce();
  expect(props.conversation.onSend).toHaveBeenCalledOnce();
  expect(props.conversation.onSend).toHaveBeenCalledWith(expect.objectContaining({ revision: 2 }));
});
it("blocks dock and share sends while working", async () => {
  props.conversation.draft = "Draw";
  await act(async () => renderer.update(<Whiteboard {...props} agentState="working" />));
  expect(button("Send").props.disabled).toBe(true);
  expect(button("Share drawing").props.disabled).toBe(true);
  await act(async () => form().props.onSubmit({ preventDefault() {} }));
  expect(props.conversation.onSend).not.toHaveBeenCalled();
});
it("requires board capability for dock edits, but image sharing still works", async () => {
  props.conversation.draft = "Draw";
  await act(async () => renderer.update(<Whiteboard {...props} structured={false} />));
  expect(button("Send").props.disabled).toBe(true);
  expect(button("Share drawing").props.disabled).toBe(false);
  expect(JSON.stringify(renderer.toJSON())).toContain("Run /reload in Pi");
  await openSheet();
  expect(renderer.root.findAllByProps({ type: "radio" })).toHaveLength(0);
});
it("disables dock and share sends during board disconnection and preserves drafts", async () => {
  props.conversation.draft = "Draw";
  await act(async () => renderer.update(<Whiteboard {...props} />));
  await act(async () => mocks.events.mock.lastCall![3]());
  expect(button("Send").props.disabled).toBe(true);
  expect(button("Share drawing").props.disabled).toBe(true);
  expect(button("Reconnect board")).toBeDefined();
  expect(props.onClose).not.toHaveBeenCalled();
});
it("locks dock submissions during image preview", async () => {
  props.conversation.draft = "Draw";
  await act(async () => renderer.update(<Whiteboard {...props} />));
  await openSheet();
  await act(async () => form().props.onSubmit({ preventDefault() {} }));
  expect(props.conversation.onSend).not.toHaveBeenCalled();
});
it.each(["export", "upload"])(
  "retains the draft and never forwards without an image when %s fails",
  async (stage) => {
    props.conversation.draft = "Finish this";
    (stage === "export" ? mocks.exportPNG : mocks.upload).mockRejectedValueOnce(
      new Error("Image failed"),
    );
    await act(async () => renderer.update(<Whiteboard {...props} />));
    await act(async () => form().props.onSubmit({ preventDefault() {} }));
    await flush();
    expect(props.conversation.onSend).not.toHaveBeenCalled();
    expect(props.conversation.onDraftChange).not.toHaveBeenCalled();
    expect(JSON.stringify(renderer.toJSON())).toContain("Image failed");
    expect(JSON.stringify(renderer.toJSON())).toContain("Draft retained. No automatic retry.");
    expect(mocks.exportPNG).toHaveBeenCalledOnce();
    expect(mocks.upload).toHaveBeenCalledTimes(stage === "export" ? 0 : 1);
  },
);
it("refuses to forward an image if the board changed during upload", async () => {
  props.conversation.draft = "Finish this";
  const uploading = deferred<{ id: string }>();
  mocks.upload.mockReturnValueOnce(uploading.promise);
  await act(async () => renderer.update(<Whiteboard {...props} />));
  await act(async () => form().props.onSubmit({ preventDefault() {} }));
  await flush();
  const editor = renderer.root.findAll(
    (node) => typeof node.type === "function" && node.type.name === "MockEditor",
  )[0];
  expect(editor.props.locked).toBe(true);
  expect(form().findByProps({ type: "submit" }).props.disabled).toBe(true);
  mocks.open.mockResolvedValue(board(2));
  await act(async () =>
    mocks.events.mock.lastCall![2]({
      type: "changed",
      revision: 2,
      access: null,
      lastAuthor: "agent",
    }),
  );
  await flush();
  await act(async () => {
    uploading.resolve({ id: "33333333-3333-4333-8333-333333333333.png" });
  });
  await flush();
  expect(props.conversation.onSend).not.toHaveBeenCalled();
  expect(JSON.stringify(renderer.toJSON())).toContain("board changed");
  expect(mocks.upload).toHaveBeenCalledOnce();
});
it.each(["unmount", "busy", "unsupported", "disconnected", "invalid scene"])(
  "blocks forwarding after %s during image upload",
  async (change) => {
    props.conversation.draft = "Finish this";
    const upload = deferred<{ id: string }>();
    mocks.upload.mockReturnValueOnce(upload.promise);
    await act(async () => renderer.update(<Whiteboard {...props} />));
    await act(async () => form().props.onSubmit({ preventDefault() {} }));
    await flush();
    if (change === "unmount") await act(async () => renderer.unmount());
    else if (change === "disconnected") await act(async () => mocks.events.mock.lastCall![3]());
    else if (change === "invalid scene") {
      const editor = renderer.root.findAll(
        (node) => typeof node.type === "function" && node.type.name === "MockEditor",
      )[0];
      await act(async () => editor.props.onError("Unsupported drawing"));
    } else
      await act(async () =>
        renderer.update(
          <Whiteboard
            {...props}
            agentState={change === "busy" ? "working" : "ready"}
            structured={change !== "unsupported"}
          />,
        ),
      );
    if (change === "unmount") expect(mocks.upload.mock.calls[0][1].aborted).toBe(true);
    await act(async () => upload.resolve({ id: "33333333-3333-4333-8333-333333333333.png" }));
    await flush();
    expect(props.conversation.onSend).not.toHaveBeenCalled();
  },
);
it("keeps failed revocation visible and does not claim access ended", async () => {
  await updateAccess({ mode: "edit", state: "active", expiresAt: Date.now() + 60000 });
  mocks.revoke.mockRejectedValueOnce(new Error("Could not revoke access"));
  await act(async () => button("Stop editing").props.onClick());
  await flush();
  expect(renderer.root.findAllByProps({ role: "alert" })).toHaveLength(1);
  expect(button("Stop editing").props.disabled).toBe(false);
});
it("does not share a preview if the agent becomes busy during PNG upload", async () => {
  await openSheet();
  const upload = deferred<{ id: string }>();
  mocks.upload.mockReturnValueOnce(upload.promise);
  let sending: Promise<void>;
  await act(async () => {
    sending = button("Send drawing").props.onClick();
  });
  await act(async () => renderer.update(<Whiteboard {...props} agentState="working" />));
  await act(async () => {
    upload.resolve({ id: "image.png" });
    await sending!;
  });
  expect(mocks.send).not.toHaveBeenCalled();
});
