import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { Agent } from "../../shared/api/contracts";
import type { Snapshot } from "../../../packages/pi-live-chat/protocol";
import { AgentConsole } from "./AgentConsole";
const mocks = vi.hoisted(() => ({
  live: {} as { snapshot?: Snapshot; error?: string },
  command: vi.fn(),
  upload: vi.fn(),
}));
vi.mock("./useLiveChat", () => ({ useLiveChat: () => mocks.live }));
vi.mock("./CloseTabButton", () => ({ CloseTabButton: () => null }));
vi.mock("./ConversationTreeDialog", () => ({ ConversationTreeDialog: () => null }));
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
    expect(form.findAllByProps({ className: "prompt-composer__spinner" })).toHaveLength(1);
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
  expect(renderer.root.findAllByProps({ className: "prompt-composer__spinner" })).toHaveLength(0);
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
  expect(renderer.root.findAllByProps({ className: "prompt-composer__spinner" })).toHaveLength(0);
});
