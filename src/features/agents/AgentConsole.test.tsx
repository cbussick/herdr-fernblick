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
it("clears a received text-and-image message, removes the manual reset button, and allows the next send", async () => {
  const file = new File(["image"], "image.png", { type: "image/png" });
  await act(async () => {
    renderer.root.findByType("textarea").props.onChange({ target: { value: "hello" } });
    renderer.root.findByProps({ type: "file" }).props.onChange({ target: { files: [file] } });
  });
  await act(async () => renderer.root.findByType("form").props.onSubmit({ preventDefault() {} }));
  await flush();
  expect(mocks.command).toHaveBeenCalledOnce();
  const id = mocks.command.mock.calls[0][5] ?? randomUUID();
  mocks.live.snapshot = {
    ...mocks.live.snapshot!,
    seq: 2,
    busy: true,
    sendPending: false,
    receivedSendIds: [id, randomUUID()],
  } as Snapshot;
  await act(async () => renderer.update(render()));
  expect(renderer.root.findByType("textarea").props.value).toBe("");
  expect(renderer.root.findAllByProps({ "aria-label": "Image attachments" })).toHaveLength(0);
  expect(JSON.stringify(renderer.toJSON())).not.toContain("Clear draft / new message");
  mocks.live.snapshot = { ...mocks.live.snapshot!, seq: 3, busy: false };
  await act(async () => renderer.update(render()));
  await act(async () =>
    renderer.root.findByType("textarea").props.onChange({ target: { value: "next" } }),
  );
  expect(renderer.root.findByProps({ "aria-label": "Send message" }).props.disabled).toBe(false);
});
it("clears an image-only message even if its HTTP ACK was lost", async () => {
  mocks.command.mockRejectedValue(new Error("Connection lost"));
  const file = new File(["image"], "image.png", { type: "image/png" });
  await act(async () =>
    renderer.root.findByProps({ type: "file" }).props.onChange({ target: { files: [file] } }),
  );
  await act(async () => renderer.root.findByType("form").props.onSubmit({ preventDefault() {} }));
  await flush();
  const id = mocks.command.mock.calls[0][5];
  expect(id).toEqual(expect.any(String));
  mocks.live.snapshot = { ...mocks.live.snapshot!, seq: 2, busy: true, receivedSendIds: [id] };
  await act(async () => renderer.update(render()));
  expect(renderer.root.findAllByProps({ "aria-label": "Image attachments" })).toHaveLength(0);
  expect(JSON.stringify(renderer.toJSON())).not.toContain("Connection lost");
});
it("does not erase a newer draft when a delayed receipt arrives", async () => {
  await act(async () =>
    renderer.root.findByType("textarea").props.onChange({ target: { value: "old" } }),
  );
  await act(async () => renderer.root.findByType("form").props.onSubmit({ preventDefault() {} }));
  await flush();
  const id = mocks.command.mock.calls[0][5];
  await act(async () =>
    renderer.root.findByType("textarea").props.onChange({ target: { value: "new draft" } }),
  );
  mocks.live.snapshot = { ...mocks.live.snapshot!, seq: 2, busy: true, receivedSendIds: [id] };
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
it("ignores a receipt from a replaced Pi runtime", async () => {
  await act(async () =>
    renderer.root.findByType("textarea").props.onChange({ target: { value: "original draft" } }),
  );
  await act(async () => renderer.root.findByType("form").props.onSubmit({ preventDefault() {} }));
  await flush();
  const id = mocks.command.mock.calls[0][5];
  mocks.live.snapshot = {
    ...mocks.live.snapshot!,
    identity: { ...mocks.live.snapshot!.identity, runtime: randomUUID() },
    receivedSendIds: [id],
  };
  await act(async () => renderer.update(render()));
  expect(renderer.root.findByType("textarea").props.value).toBe("original draft");
});
it("preserves text and attachments when delivery fails without a receipt", async () => {
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
});
