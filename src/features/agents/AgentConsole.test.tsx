import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { Agent } from "../../shared/api/contracts";
import type { Snapshot } from "../../../packages/pi-live-chat/protocol";
import { AgentConsole } from "./AgentConsole";
import { Whiteboard } from "../whiteboard/Whiteboard";
import type { WhiteboardConversation } from "../whiteboard/ConversationDock";
const mocks = vi.hoisted(() => ({
  live: {} as { snapshot?: Snapshot; error?: string },
  command: vi.fn(),
  compact: vi.fn(),
  boardPrompt: vi.fn(),
  upload: vi.fn(),
  skills: vi.fn(),
  output: vi.fn(),
}));
vi.mock("../whiteboard/boardApi", () => ({ boardApi: { prompt: mocks.boardPrompt } }));
vi.mock("./useLiveChat", () => ({ useLiveChat: () => mocks.live }));
vi.mock("./CloseTabButton", () => ({ CloseTabButton: () => null }));
vi.mock("./ConversationTreeDialog", () => ({ ConversationTreeDialog: () => null }));
vi.mock("../whiteboard/Whiteboard", () => ({ Whiteboard: () => null }));
vi.mock("../../shared/api/apiClient", () => ({
  chatCommand: mocks.command,
  compactAgentConversation: mocks.compact,
  uploadImage: mocks.upload,
  getAgentSkills: mocks.skills,
  getAgentOutput: mocks.output,
  sendAgentKey: vi.fn(),
}));
let renderer: ReactTestRenderer;
let client: QueryClient;
const agent = { agent: "pi", pane_id: "w1:p1", name: "test", agent_status: "idle" } as Agent;
function render(currentAgent = agent) {
  return (
    <QueryClientProvider client={client}>
      <AgentConsole agent={currentAgent} onBack={() => {}} />
    </QueryClientProvider>
  );
}
async function flush() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 15));
  });
}
async function openSkills() {
  await act(async () =>
    renderer.root
      .findAllByType("button")
      .find((button) => button.children.includes(" Skills"))!
      .props.onClick(),
  );
  await flush();
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
  mocks.compact.mockReset().mockResolvedValue({ type: "compacted" });
  mocks.boardPrompt.mockReset().mockResolvedValue({ type: "ack", outcome: "invoked" });
  mocks.upload.mockReset().mockResolvedValue({ id: `${randomUUID()}.png` });
  mocks.skills.mockReset().mockResolvedValue({
    skills: [
      {
        name: "review",
        description: "Review the changes",
        path: "/home/.agents/skills/review/SKILL.md",
        scope: "user",
      },
    ],
    truncated: false,
  });
  mocks.output.mockReset().mockImplementation(async (_pane, source) => ({
    pane_id: agent.pane_id,
    tab_id: "w1:t1",
    workspace_id: "w1",
    revision: 1,
    format: "text",
    source,
    text: source === "visible" ? "Current screen" : "Older terminal history",
    truncated: false,
  }));
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
async function openActions() {
  await act(async () =>
    renderer.root.findByProps({ "data-ui": "conversation-actions-button" }).props.onClick(),
  );
}
async function confirmCompact() {
  await openActions();
  await act(async () =>
    renderer.root
      .findByProps({ role: "menuitem", "aria-label": "Compact conversation" })
      .props.onClick(),
  );
}
function compactNow() {
  return renderer.root.findAllByType("button").find((b) => b.children.includes("Compact now"))!;
}
async function enableCompact() {
  mocks.live.snapshot = { ...mocks.live.snapshot!, capabilities: { compact: true } };
  await act(async () => renderer.update(render()));
}
it("cancels compact confirmation with Cancel or Escape without invoking Pi or changing the draft", async () => {
  await enableCompact();
  await act(async () =>
    renderer.root.findByType("textarea").props.onChange({ target: { value: "keep this" } }),
  );
  await confirmCompact();
  expect(
    renderer.root.findByProps({ "data-ui": "conversation-actions-button" }).props["aria-expanded"],
  ).toBe(false);
  await act(async () =>
    renderer.root
      .findAllByType("button")
      .find((b) => b.children.includes("Cancel"))!
      .props.onClick(),
  );
  expect(compactNow()).toBeUndefined();
  await confirmCompact();
  const event = { key: "Escape", preventDefault: vi.fn(), stopPropagation: vi.fn() };
  await act(async () =>
    renderer.root.findByProps({ "data-ui": "conversation-compaction" }).props.onKeyDown(event),
  );
  expect(event.preventDefault).toHaveBeenCalledOnce();
  expect(event.stopPropagation).toHaveBeenCalledOnce();
  expect(compactNow()).toBeUndefined();
  expect(renderer.root.findByType("textarea").props.value).toBe("keep this");
  expect(mocks.compact).not.toHaveBeenCalled();
});

it("explains and compacts separately from Skills, waits for completion and preserves text/images", async () => {
  await enableCompact();
  let complete!: () => void;
  mocks.compact.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        complete = resolve;
      }),
  );
  const file = new File(["image"], "image.png", { type: "image/png" });
  await act(async () => {
    renderer.root.findByType("textarea").props.onChange({ target: { value: "keep my draft" } });
    renderer.root.findByProps({ type: "file" }).props.onChange({ target: { files: [file] } });
  });
  await confirmCompact();
  expect(JSON.stringify(renderer.toJSON())).toContain("does not clear the conversation");
  const click = compactNow().props.onClick;
  await act(async () => {
    click();
    click();
  });
  await flush();
  expect(mocks.compact).toHaveBeenCalledOnce();
  expect(mocks.command).not.toHaveBeenCalled();
  expect(mocks.upload).not.toHaveBeenCalled();
  expect(renderer.root.findByProps({ "aria-label": "Send message" }).props.disabled).toBe(true);
  expect(JSON.stringify(renderer.toJSON())).toContain("waiting for Pi to finish");
  expect(JSON.stringify(renderer.toJSON())).not.toContain("Conversation compacted.");
  expect(renderer.root.findByType("textarea").props.disabled).toBe(false);
  await act(async () => complete());
  await flush();
  expect(JSON.stringify(renderer.toJSON())).toContain("Conversation compacted.");
  expect(renderer.root.findByType("textarea").props.value).toBe("keep my draft");
  expect(renderer.root.findAllByProps({ "aria-label": "Image attachments" })).toHaveLength(1);
});

it("labels terminal compaction without invoking the UI action and preserves the draft", async () => {
  await act(async () =>
    renderer.root.findByType("textarea").props.onChange({ target: { value: "keep this draft" } }),
  );
  mocks.live.snapshot = { ...mocks.live.snapshot!, busy: true, compacting: true };
  await act(async () => renderer.update(render()));
  expect(JSON.stringify(renderer.toJSON())).toContain("Compacting…");
  expect(renderer.root.findByProps({ "aria-label": "Send message" }).props.disabled).toBe(true);
  expect(renderer.root.findByType("textarea").props.disabled).toBe(false);
  expect(renderer.root.findByType("textarea").props.value).toBe("keep this draft");
  expect(mocks.compact).not.toHaveBeenCalled();
  expect(JSON.stringify(renderer.toJSON())).not.toContain("Conversation compacted.");

  // Automatic compaction may continue into another agent turn.
  mocks.live.snapshot = { ...mocks.live.snapshot!, compacting: false };
  await act(async () => renderer.update(render()));
  expect(JSON.stringify(renderer.toJSON())).not.toContain("Compacting…");
  expect(JSON.stringify(renderer.toJSON())).toContain("Working");
  mocks.live.snapshot = { ...mocks.live.snapshot!, busy: false };
  await act(async () => renderer.update(render()));
  expect(renderer.root.findByProps({ "aria-label": "Send message" }).props.disabled).toBe(false);
  expect(renderer.root.findByType("textarea").props.value).toBe("keep this draft");
});

it.each(["unsupported", "disconnected"])("disables compact when %s", async (mode) => {
  await enableCompact();
  if (mode === "unsupported") mocks.live.snapshot = { ...mocks.live.snapshot!, capabilities: {} };
  if (mode === "disconnected") mocks.live.error = "Connection lost";
  await act(async () => renderer.update(render()));
  await openActions();
  const button = renderer.root.findByProps({
    role: "menuitem",
    "aria-label": "Compact conversation",
  });
  expect(button.props["aria-disabled"]).toBe(true);
  expect(button.findByType("small").children.join("")).toMatch(/Connect|reload|idle/);
  await act(async () => button.props.onClick());
  expect(compactNow()).toBeUndefined();
  expect(mocks.compact).not.toHaveBeenCalled();
});

it("invalidates an open compact confirmation on replacement and rechecks busy state before execution", async () => {
  await enableCompact();
  await confirmCompact();
  const oldClick = compactNow().props.onClick;
  mocks.live.snapshot = { ...mocks.live.snapshot!, busy: true };
  await act(async () => renderer.update(render()));
  expect(compactNow().props.disabled).toBe(true);
  await act(async () => oldClick());
  expect(mocks.compact).not.toHaveBeenCalled();
  mocks.live.snapshot = { ...mocks.live.snapshot!, busy: false };
  await act(async () => renderer.update(render()));
  await confirmCompact();
  mocks.live.snapshot = { ...mocks.live.snapshot!, epoch: randomUUID() };
  await act(async () => renderer.update(render()));
  expect(compactNow()).toBeUndefined();
});

it.each(["disconnect", "replacement", "error"])(
  "retains draft and reports %s without retry or false compact success",
  async (mode) => {
    await enableCompact();
    let complete!: () => void;
    let fail!: (error: Error) => void;
    mocks.compact.mockImplementation(
      () =>
        new Promise<void>((resolve, reject) => {
          complete = resolve;
          fail = reject;
        }),
    );
    await act(async () =>
      renderer.root.findByType("textarea").props.onChange({ target: { value: "retain me" } }),
    );
    await confirmCompact();
    await act(async () => compactNow().props.onClick());
    await flush();
    if (mode === "disconnect") mocks.live.error = "Connection lost";
    if (mode === "replacement")
      mocks.live.snapshot = { ...mocks.live.snapshot!, epoch: randomUUID() };
    await act(async () => renderer.update(render()));
    if (mode !== "error") expect(JSON.stringify(renderer.toJSON())).toContain("outcome uncertain");
    await act(async () => (mode === "error" ? fail(new Error("Nothing to compact")) : complete()));
    await flush();
    expect(JSON.stringify(renderer.toJSON())).not.toContain("Conversation compacted.");
    expect(JSON.stringify(renderer.toJSON())).toContain(
      mode === "error" ? "Nothing to compact" : "outcome uncertain",
    );
    expect(renderer.root.findByType("textarea").props.value).toBe("retain me");
    expect(mocks.compact).toHaveBeenCalledOnce();
  },
);

it("shows the live terminal by default and keeps loaded history when the agent starts working", async () => {
  await act(async () =>
    renderer.root.findByProps({ "aria-label": "Switch to Terminal view" }).props.onClick(),
  );
  await flush();
  expect(mocks.output.mock.calls[0].slice(0, 2)).toEqual([agent.pane_id, "visible"]);
  const historyButton = () =>
    renderer.root
      .findAllByType("button")
      .find(
        (button) =>
          button.children.includes("Load history") || button.children.includes("Refresh history"),
      )!;
  expect(historyButton().props.disabled).toBe(false);
  await act(async () => historyButton().props.onClick());
  await flush();
  expect(renderer.root.findByType("pre").children).toEqual(["Older terminal history"]);
  await act(async () => renderer.update(render({ ...agent, agent_status: "working" })));
  expect(historyButton().props.disabled).toBe(true);
  expect(renderer.root.findByType("pre").children).toEqual(["Older terminal history"]);
  expect(mocks.output.mock.calls.map((call) => call[1])).toEqual(["visible", "recent_unwrapped"]);
});

it("selects and searches skills without sending or losing draft text and images", async () => {
  mocks.live.snapshot = { ...mocks.live.snapshot!, capabilities: { skills: true }, busy: true };
  await act(async () => renderer.update(render()));
  const file = new File(["image"], "image.png", { type: "image/png" });
  await act(async () => {
    renderer.root.findByType("textarea").props.onChange({ target: { value: "check my diff" } });
    renderer.root.findByProps({ type: "file" }).props.onChange({ target: { files: [file] } });
  });
  await openSkills();
  expect(mocks.skills).toHaveBeenCalledOnce();
  await act(async () => renderer.root.findByProps({ role: "option" }).props.onClick());
  expect(renderer.root.findByType("textarea").props.value).toBe("/skill:review check my diff");
  expect(renderer.root.findAllByProps({ "aria-label": "Image attachments" })).toHaveLength(1);
  expect(renderer.root.findByProps({ "aria-label": "Send message" }).props.disabled).toBe(true);
  expect(mocks.command).not.toHaveBeenCalled();
  await openSkills();
  await act(async () =>
    renderer.root.findByProps({ role: "combobox" }).props.onChange({ target: { value: "rev" } }),
  );
  expect(renderer.root.findAllByProps({ role: "option" })).toHaveLength(1);
  await act(async () =>
    renderer.root.findByProps({ role: "combobox" }).props.onKeyDown({
      key: "Enter",
      nativeEvent: {},
      preventDefault() {},
    }),
  );
  expect(renderer.root.findByType("textarea").props.value).toBe("/skill:review check my diff");
  expect(mocks.command).not.toHaveBeenCalled();
});

it("reselects a typed skill without duplicating it or opening the picker automatically", async () => {
  mocks.live.snapshot = { ...mocks.live.snapshot!, capabilities: { skills: true } };
  await act(async () => renderer.update(render()));
  await act(async () =>
    renderer.root.findByType("textarea").props.onChange({ target: { value: "/skill:review" } }),
  );
  await flush();
  expect(renderer.root.findAllByProps({ "data-testid": "skill-picker" })).toHaveLength(0);
  expect(renderer.root.findByType("textarea").props.value).toBe("/skill:review");
  expect(mocks.skills).not.toHaveBeenCalled();
  await openSkills();
  await act(async () => renderer.root.findByProps({ role: "option" }).props.onClick());
  expect(renderer.root.findByType("textarea").props.value).toBe("/skill:review ");
  expect(mocks.command).not.toHaveBeenCalled();
});

it("shows skill errors and empty states, hides stale choices on disconnect, and keeps slash drafts", async () => {
  mocks.live.snapshot = { ...mocks.live.snapshot!, capabilities: { skills: true } };
  mocks.skills.mockRejectedValueOnce(new Error("Skills offline"));
  await act(async () => renderer.update(render()));
  await act(async () =>
    renderer.root.findByType("textarea").props.onChange({ target: { value: "/" } }),
  );
  await openSkills();
  expect(JSON.stringify(renderer.toJSON())).toContain("Skills offline");
  expect(renderer.root.findAllByProps({ role: "option" })).toHaveLength(0);
  mocks.skills.mockResolvedValueOnce({ skills: [], truncated: false });
  await act(async () =>
    renderer.root
      .findAllByType("button")
      .find((b) => b.children.includes("Try again"))!
      .props.onClick(),
  );
  await flush();
  expect(JSON.stringify(renderer.toJSON())).toContain("No skills loaded");
  mocks.live.error = "Reconnecting";
  await act(async () => renderer.update(render()));
  expect(JSON.stringify(renderer.toJSON())).toContain("Connect to Pi live chat");
  expect(renderer.root.findByType("textarea").props.value).toBe("/");
  await act(async () =>
    renderer.root.findByProps({ role: "combobox" }).props.onKeyDown({
      key: "Escape",
      nativeEvent: {},
      preventDefault() {},
      stopPropagation() {},
    }),
  );
  expect(renderer.root.findAllByProps({ "data-testid": "skill-picker" })).toHaveLength(0);
  expect(renderer.root.findByType("textarea").props.value).toBe("/");
});

it("accepts ten images across selections, caps overflow and restores capacity after removal", async () => {
  const files = Array.from(
    { length: 11 },
    (_, i) => new File(["image"], `image-${i}.png`, { type: "image/png" }),
  );
  const select = async (selected: File[]) =>
    act(async () =>
      renderer.root.findByProps({ type: "file" }).props.onChange({ target: { files: selected } }),
    );
  const previews = () =>
    renderer.root.findByProps({ "aria-label": "Image attachments" }).findAllByType("img");
  await select(files.slice(0, 4));
  expect(renderer.root.findByProps({ "aria-label": "Attach images" }).props.disabled).toBe(false);
  await select(files.slice(4));
  expect(previews().map((image) => image.props.alt)).toEqual(
    files.slice(0, 10).map((file) => file.name),
  );
  expect(renderer.root.findByProps({ "aria-label": "Attach images" }).props.disabled).toBe(true);
  expect(JSON.stringify(renderer.toJSON())).toContain("Choose up to 10 PNG");
  await act(async () =>
    renderer.root.findByProps({ "aria-label": "Remove image 10" }).props.onClick(),
  );
  expect(renderer.root.findByProps({ "aria-label": "Attach images" }).props.disabled).toBe(false);
  await select([files[10]]);
  expect(previews()).toHaveLength(10);
  await act(async () => renderer.root.findByType("form").props.onSubmit({ preventDefault() {} }));
  await flush();
  expect(mocks.upload).toHaveBeenCalledTimes(10);
  expect(mocks.upload.mock.calls.map(([file]) => file.name)).toEqual(
    [...files.slice(0, 9), files[10]].map((file) => file.name),
  );
  expect(mocks.command).toHaveBeenCalledWith(
    agent.pane_id,
    expect.anything(),
    "prompt",
    "",
    expect.arrayContaining(Array(10).fill(expect.any(String))),
    expect.any(String),
  );
  expect(mocks.command.mock.calls[0][4]).toHaveLength(10);
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
  mocks.live.snapshot = { ...mocks.live.snapshot!, seq: 3, busy: false };
  await act(async () => renderer.update(render()));
  await act(async () =>
    renderer.root.findByType("textarea").props.onChange({ target: { value: "next" } }),
  );
  expect(renderer.root.findByProps({ "aria-label": "Send message" }).props.disabled).toBe(false);
});
it.each(["", "keep me"])("retains text %j and images when forwarding fails", async (draft) => {
  mocks.command.mockRejectedValue(new Error("Connection lost"));
  const file = new File(["image"], "image.png", { type: "image/png" });
  await act(async () => {
    renderer.root.findByType("textarea").props.onChange({ target: { value: draft } });
    renderer.root.findByProps({ type: "file" }).props.onChange({ target: { files: [file] } });
  });
  await act(async () => renderer.root.findByType("form").props.onSubmit({ preventDefault() {} }));
  await flush();
  expect(renderer.root.findByType("textarea").props.value).toBe(draft);
  expect(renderer.root.findAllByProps({ "aria-label": "Image attachments" })).toHaveLength(1);
  expect(renderer.root.findByType("textarea").props.disabled).toBe(false);
  expect(renderer.root.findByProps({ "aria-label": "Attach images" }).props.disabled).toBe(false);
  expect(renderer.root.findAllByProps({ "data-testid": "send-spinner" })).toHaveLength(0);
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
it("ignores a late stop ACK after the agent becomes idle and starts again", async () => {
  let acknowledge!: () => void;
  mocks.command.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        acknowledge = resolve;
      }),
  );
  mocks.live.snapshot = { ...mocks.live.snapshot!, busy: true };
  await act(async () => renderer.update(render()));
  await act(async () =>
    renderer.root
      .findAllByType("button")
      .find((b) => b.children.includes("Stop"))!
      .props.onClick(),
  );
  await flush();
  mocks.live.snapshot = { ...mocks.live.snapshot!, busy: false };
  await act(async () => renderer.update(render()));
  mocks.live.snapshot = { ...mocks.live.snapshot!, busy: true };
  await act(async () => renderer.update(render()));
  await act(async () => acknowledge());
  await flush();
  expect(JSON.stringify(renderer.toJSON())).not.toContain("Abort invoked");
  expect(
    renderer.root.findAllByType("button").find((b) => b.children.includes("Stop"))?.props.disabled,
  ).toBe(false);
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
it.each(["busy", "closed", "epoch"])(
  "revalidates a captured dock send against %s state",
  async (state) => {
    await openBoard();
    await act(async () => boardConversation().onDraftChange("Do not send stale text"));
    const submit = boardConversation().onSend;
    if (state === "closed")
      await act(async () => renderer.root.findByType(Whiteboard).props.onClose());
    else if (state === "busy") mocks.live.snapshot = { ...mocks.live.snapshot!, busy: true };
    else mocks.live.snapshot = { ...mocks.live.snapshot!, epoch: randomUUID() };
    await act(async () => renderer.update(render()));
    await act(async () =>
      submit({ boardId: "a".repeat(64), revision: 1, text: "Do not send stale text" }),
    );
    await flush();
    expect(mocks.boardPrompt).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
  },
);
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
  await openSkills();
  expect(mocks.skills).not.toHaveBeenCalled();
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
  expect(renderer.root.findByType("textarea").props.disabled).toBe(false);
  expect(renderer.root.findByProps({ "aria-label": "Send message" }).props.disabled).toBe(true);
  mocks.live.snapshot = { ...mocks.live.snapshot!, seq: 3, busy: true, sendPending: false };
  await act(async () => renderer.update(render()));
  expect(renderer.root.findByType("form").props["aria-busy"]).toBe(false);
  expect(renderer.root.findByType("textarea").props.disabled).toBe(false);
  expect(renderer.root.findByProps({ type: "file" }).props.disabled).toBe(false);
  expect(renderer.root.findByProps({ "aria-label": "Attach images" }).props.disabled).toBe(false);
  expect(renderer.root.findAllByProps({ "data-testid": "send-spinner" })).toHaveLength(0);
  expect(renderer.root.findByProps({ "aria-label": "Send message" }).props.disabled).toBe(true);
});
it("shows startup and failure states while keeping send disabled", async () => {
  mocks.live = {};
  await act(async () => renderer.update(render()));
  const state = renderer.root.findByProps({ role: "status" });
  expect(state.props["aria-busy"]).toBe("true");
  expect(JSON.stringify(renderer.toJSON())).toContain("Starting Pi…");
  expect(renderer.root.findAllByProps({ role: "alert" })).toHaveLength(0);
  expect(renderer.root.findByProps({ "aria-label": "Send message" }).props.disabled).toBe(true);
  mocks.live = { error: "Cannot reach Pi" };
  await act(async () => renderer.update(render()));
  expect(renderer.root.findByProps({ role: "alert" }).findByType("p").children).toEqual([
    "Cannot reach Pi",
  ]);
  expect(renderer.root.findByProps({ "aria-label": "Send message" }).props.disabled).toBe(true);
});
