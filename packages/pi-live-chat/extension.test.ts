import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile, open } from "node:fs/promises";
import { createServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  ExtensionAPI,
  ExtensionContext,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { afterEach, expect, it, vi } from "vitest";
import liveChat from "./index.js";
import { snapshotSchema, targetOf, type Snapshot } from "./protocol.js";
import { receiveFrames, writeFrame } from "./transport.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs/promises")>();
  return { ...fs, open: vi.fn(fs.open) };
});
vi.mock("./security.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("./security.js")>();
  return {
    ...original,
    processIdentity: vi.fn(async () => ({
      start: "456",
      foreground: true,
      alive: true,
      pane: "w1:p1",
      herdrSocket: "/herdr.sock",
    })),
  };
});
type Handler = (event: Record<string, unknown>, ctx: ExtensionContext) => unknown;
function fakePi(session = "session") {
  const handlers = new Map<string, Handler[]>();
  const branch: unknown[] = [];
  const commands = new Map<
    string,
    { handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> }
  >();
  let idle = true;
  const ctx = {
    mode: "tui",
    cwd: "/test",
    model: { id: "model", provider: "provider" },
    isIdle: () => idle,
    hasPendingMessages: () => false,
    abort: vi.fn(),
    sessionManager: {
      getBranch: () => branch,
      getEntries: () => branch,
      getTree: vi.fn(() => []),
      getLeafId: () => (branch.at(-1) as { id?: string })?.id ?? null,
      getEntry: (id: string) => branch.find((e) => (e as { id: string }).id === id),
      getSessionId: () => session,
      getSessionFile: () => `/${session}.jsonl`,
    },
  } as unknown as ExtensionContext;
  const pi = {
    on: (event: string, handler: Handler) => {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    },
    sendUserMessage: vi.fn(),
    registerCommand: (
      name: string,
      command: { handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> },
    ) => commands.set(name, command),
    getCommands: () => [...commands.keys()].map((name) => ({ name })),
    appendEntry: vi.fn((customType: string, data: unknown) => {
      branch.push({ type: "custom", id: randomUUID(), customType, data });
    }),
  };
  liveChat(pi as unknown as ExtensionAPI);
  const emit = (event: string, data: Record<string, unknown> = {}) =>
    (handlers.get(event) ?? []).map((handler) => handler({ type: event, ...data }, ctx));
  return {
    pi,
    commands,
    ctx,
    branch,
    emit,
    setIdle: (value: boolean) => {
      idle = value;
    },
  };
}
const cleanup: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn();
  cleanup.length = 0;
  vi.unstubAllEnvs();
});
async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "fb-ext-"));
  const path = join(dir, "pi.sock");
  vi.stubEnv("FERNBLICK_PI_SOCKET", path);
  const frames: unknown[] = [];
  const connections: Socket[] = [];
  const server = createServer((socket) => {
    connections.push(socket);
    receiveFrames(socket, (value) => frames.push(value));
  });
  await new Promise<void>((done) => server.listen(path, done));
  const { chmod } = await import("node:fs/promises");
  await chmod(path, 0o600);
  cleanup.push(async () => {
    for (const s of connections) s.destroy();
    await new Promise<void>((done) => server.close(() => done()));
    await rm(dir, { recursive: true, force: true });
  });
  const pi = fakePi();
  cleanup.push(() => {
    pi.emit("session_shutdown");
  });
  function latest() {
    return frames.filter((v) => snapshotSchema.safeParse(v).success).at(-1) as Snapshot | undefined;
  }
  expect(pi.emit("session_start")).toEqual([undefined]);
  await vi.waitFor(() => expect(latest()).toBeDefined());
  const command = (action: "send" | "stop", target = targetOf(latest()!), text = "hello") => {
    const id = randomUUID();
    writeFrame(connections.at(-1)!, {
      type: "command",
      action,
      target,
      id,
      ...(action === "send" ? { text } : {}),
    });
    return id;
  };
  const ack = async (id: string) => {
    let found: unknown;
    await vi.waitFor(() => {
      found = frames.find((v) => typeof v === "object" && v && "id" in v && v.id === id);
      expect(found).toBeDefined();
    });
    return found;
  };
  return { ...pi, latest, command, ack, connections, frames, server, dir };
}
it("uses real Pi 0.99.1 command dispatch and navigateTree(user.id) to reach the root without model work", async () => {
  const t = await setup();
  t.emit("session_shutdown");
  vi.stubEnv("PI_OFFLINE", "1");
  const { createAgentSession, DefaultResourceLoader, SessionManager, SettingsManager } =
    await import("@earendil-works/pi-coding-agent");
  const manager = SessionManager.create(t.dir, join(t.dir, "sessions"));
  const root = manager.appendMessage({
    role: "user",
    content: "original root prompt",
    timestamp: 1,
  });
  const active = manager.appendMessage({ role: "user", content: "active branch", timestamp: 2 });
  manager.branch(root);
  const alternate = manager.appendMessage({
    role: "user",
    content: "abandoned branch",
    timestamp: 3,
  });
  manager.branch(active);
  manager.appendLabelChange(root, "checkpoint");
  const settingsManager = SettingsManager.inMemory();
  const agentDir = join(t.dir, "isolated-agent");
  const resourceLoader = new DefaultResourceLoader({
    cwd: t.dir,
    agentDir,
    settingsManager,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    extensionFactories: [liveChat],
  });
  await resourceLoader.reload();
  const { session } = await createAgentSession({
    cwd: t.dir,
    agentDir,
    resourceLoader,
    settingsManager,
    sessionManager: manager,
    tools: [],
  });
  const prompt = vi.spyOn(session.agent, "prompt");
  const stream = vi.fn(() => {
    throw new Error("Model must never be called");
  });
  session.agent.streamFunction = stream;
  const errors: unknown[] = [];
  try {
    await session.bindExtensions({
      mode: "tui",
      onError: (e) => errors.push(e),
      commandContextActions: {
        navigateTree: (id, options) => session.navigateTree(id, options),
        waitForIdle: () => session.waitForIdle(),
        newSession: async () => {
          throw new Error("not used");
        },
        fork: async () => {
          throw new Error("not used");
        },
        switchSession: async () => {
          throw new Error("not used");
        },
        reload: async () => {
          throw new Error("not used");
        },
      },
    });
    await vi.waitFor(() => expect(t.latest()?.identity.sessionId).toBe(manager.getSessionId()));
    const treeId = randomUUID();
    writeFrame(t.connections.at(-1)!, {
      type: "command",
      id: treeId,
      target: targetOf(t.latest()!),
      action: "tree",
    });
    const tree = (await t.ack(treeId)) as {
      tree: {
        roots: { label?: string; children: { id: string; isActivePath: boolean }[] }[];
        leafId: string;
      };
    };
    expect(tree.tree.leafId).toBe(active);
    expect(tree.tree.roots[0].label).toBe("checkpoint");
    expect(tree.tree.roots[0].children).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: active, isActivePath: true }),
        expect.objectContaining({ id: alternate, isActivePath: false }),
      ]),
    );
    const id = randomUUID();
    writeFrame(t.connections.at(-1)!, {
      type: "command",
      id,
      target: targetOf(t.latest()!),
      action: "navigate",
      entryId: root,
    });
    expect(await t.ack(id)).toMatchObject({
      type: "navigated",
      prompt: { text: "original root prompt", attachments: [] },
    });
    expect(manager.getLeafId()).toBeNull();
    await session.sendUserMessage("/fernblick-bridge-stale-token ignored", {
      expandPromptTemplates: true,
    });
    expect(prompt).not.toHaveBeenCalled();
    expect(stream).not.toHaveBeenCalled();
    expect(errors).toEqual([]);
  } finally {
    await session.extensionRunner?.emit({ type: "session_shutdown", reason: "quit" });
    session.dispose();
  }
}, 20_000);

it("navigates through its private command context and replies only after navigation completes", async () => {
  const t = await setup();
  const entry = {
    type: "message",
    id: "u",
    parentId: null,
    message: { role: "user", content: "restore me", timestamp: 1 },
  };
  t.branch.push(entry);
  let complete!: () => void;
  const navigateTree = vi.fn(
    () =>
      new Promise<{ cancelled: boolean }>((done) => {
        complete = () => {
          t.branch.length = 0;
          t.emit("session_tree");
          done({ cancelled: false });
        };
      }),
  );
  t.pi.sendUserMessage.mockImplementation((text, options) => {
    expect(options).toEqual({ expandPromptTemplates: true });
    const [name, nonce] = (text as string).slice(1).split(" ");
    void t.commands
      .get(name)!
      .handler(nonce, { ...t.ctx, navigateTree } as unknown as ExtensionCommandContext);
  });
  const id = randomUUID();
  writeFrame(t.connections[0], {
    type: "command",
    id,
    target: targetOf(t.latest()!),
    action: "navigate",
    entryId: "u",
  });
  await vi.waitFor(() => expect(navigateTree).toHaveBeenCalledWith("u", { summarize: false }));
  expect(t.frames.some((v) => (v as { id?: string }).id === id)).toBe(false);
  complete();
  expect(await t.ack(id)).toMatchObject({
    type: "navigated",
    id,
    prompt: { text: "restore me", attachments: [] },
  });
});

it("reads the labeled active conversation tree over the socket on demand", async () => {
  const t = await setup();
  const entry = {
    type: "message",
    id: "user1",
    parentId: null,
    timestamp: "2026-01-01T00:00:00Z",
    message: { role: "user", content: "branch from here", timestamp: 1 },
  };
  t.branch.push(entry);
  vi.mocked(t.ctx.sessionManager.getTree).mockReturnValue([
    { entry: entry as never, children: [], label: "checkpoint" },
  ]);
  const id = randomUUID();
  writeFrame(t.connections[0], {
    type: "command",
    id,
    target: targetOf(t.latest()!),
    action: "tree",
  });
  expect(await t.ack(id)).toMatchObject({
    type: "tree",
    id,
    tree: {
      leafId: "user1",
      roots: [
        {
          id: "user1",
          role: "user",
          text: "branch from here",
          label: "checkpoint",
          isActivePath: true,
        },
      ],
    },
  });
  expect(t.pi.sendUserMessage).not.toHaveBeenCalled();
});

it("sends four 10 MiB image-only uploads as Pi ImageContent without putting base64 on the socket", async () => {
  const t = await setup();
  vi.stubEnv("FERNBLICK_UPLOAD_DIR", t.dir);
  const attachments = Array.from({ length: 4 }, () => `${randomUUID()}.png`);
  const bytes = Buffer.alloc(10 * 1024 * 1024);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
  for (const [i, id] of attachments.entries()) {
    bytes[bytes.length - 1] = i;
    await writeFile(join(t.dir, id), bytes, { mode: 0o600 });
  }
  const id = randomUUID();
  const command = {
    type: "command",
    id,
    target: targetOf(t.latest()!),
    action: "send",
    text: "",
    attachments,
  };
  expect(Buffer.byteLength(JSON.stringify(command))).toBeLessThan(1000);
  writeFrame(t.connections[0], command);
  await vi.waitFor(() => expect(t.pi.sendUserMessage).toHaveBeenCalledOnce());
  const content = t.pi.sendUserMessage.mock.calls[0][0] as {
    type: string;
    data: string;
    mimeType: string;
  }[];
  expect(content.filter((b) => b.type === "image")).toHaveLength(4);
  for (const image of content.filter((b) => b.type === "image")) {
    expect(image.mimeType).toBe("image/png");
    expect(Buffer.from(image.data, "base64").length).toBe(10 * 1024 * 1024);
  }
  expect(await t.ack(id)).toMatchObject({ outcome: "invoked" });
  const message = { role: "user", timestamp: 55, content };
  t.emit("message_start", { message });
  t.branch.push({ type: "message", id: "persisted-images", parentId: null, message });
  t.emit("turn_end");
  await vi.waitFor(() =>
    expect(t.latest()?.messages.at(-1)?.attachments).toEqual(
      attachments.map((id) => `/api/uploads/${id}`),
    ),
  );
  t.emit("agent_settled");
  t.pi.sendUserMessage.mockImplementationOnce((text, options) => {
    expect(options).toEqual({ expandPromptTemplates: true });
    const [name, nonce] = (text as string).slice(1).split(" ");
    void t.commands.get(name)!.handler(nonce, {
      ...t.ctx,
      navigateTree: async () => {
        t.branch.length = 0;
        t.emit("session_tree");
        return { cancelled: false };
      },
    } as unknown as ExtensionCommandContext);
  });
  const navId = randomUUID();
  writeFrame(t.connections[0], {
    type: "command",
    id: navId,
    action: "navigate",
    target: targetOf(t.latest()!),
    entryId: "persisted-images",
  });
  expect(await t.ack(navId)).toMatchObject({
    type: "navigated",
    prompt: { text: "", attachments },
  });
});

it.each(["epoch", "session", "busy"] as const)(
  "rechecks %s after async image preparation before invoking Pi",
  async (change) => {
    const t = await setup();
    vi.stubEnv("FERNBLICK_UPLOAD_DIR", t.dir);
    const imageId = `${randomUUID()}.png`;
    await writeFile(join(t.dir, imageId), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), {
      mode: 0o600,
    });
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>((done) => {
      release = done;
    });
    const started = new Promise<void>((done) => {
      entered = done;
    });
    const fs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    vi.mocked(open).mockImplementationOnce(async (...args) => {
      const file = await fs.open(...args);
      return new Proxy(file, {
        get(target, prop) {
          if (prop === "read")
            return async (...readArgs: Parameters<typeof file.read>) => {
              entered();
              await gate;
              return file.read(...readArgs);
            };
          const value = Reflect.get(target, prop);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    });
    const id = randomUUID();
    writeFrame(t.connections[0], {
      type: "command",
      id,
      action: "send",
      target: targetOf(t.latest()!),
      text: "",
      attachments: [imageId],
    });
    await started;
    if (change === "epoch") t.emit("session_tree");
    else if (change === "session") t.emit("session_shutdown");
    else t.setIdle(false);
    release();
    if (change !== "session") expect(await t.ack(id)).toMatchObject({ outcome: "rejected" });
    else await new Promise((done) => setTimeout(done, 50));
    expect(t.pi.sendUserMessage).not.toHaveBeenCalled();
  },
);

it("rejects missing handlers, busy and missing entries without navigating or leaking tokens", async () => {
  const t = await setup();
  const navigateTree = vi.fn();
  t.pi.sendUserMessage.mockImplementation((text) => {
    const [name, nonce] = (text as string).slice(1).split(" ");
    void t.commands
      .get(name)!
      .handler(nonce, { ...t.ctx, navigateTree } as unknown as ExtensionCommandContext);
  });
  const send = () => {
    const id = randomUUID();
    writeFrame(t.connections[0], {
      type: "command",
      id,
      action: "navigate",
      target: targetOf(t.latest()!),
      entryId: "missing",
    });
    return t.ack(id);
  };
  expect(await send()).toMatchObject({
    outcome: "rejected",
    reason: expect.stringContaining("entry"),
  });
  t.setIdle(false);
  expect(await send()).toMatchObject({
    outcome: "rejected",
    reason: expect.stringContaining("busy"),
  });
  t.setIdle(true);
  t.commands.clear();
  const before = t.pi.sendUserMessage.mock.calls.length;
  expect(await send()).toMatchObject({
    outcome: "rejected",
    reason: expect.stringContaining("handler"),
  });
  expect(t.pi.sendUserMessage).toHaveBeenCalledTimes(before);
  expect(navigateTree).not.toHaveBeenCalled();
  expect(t.emit("input", { text: "/fernblick-bridge-expired nonce", source: "extension" })).toEqual(
    [{ action: "handled" }],
  );
});

it("uses void send/abort, rejects busy and concurrent sends, and waits for settled not agent_end", async () => {
  const t = await setup();
  expect(await t.ack(t.command("send"))).toMatchObject({ outcome: "invoked" });
  expect(t.pi.sendUserMessage).toHaveBeenCalledWith("hello", { expandPromptTemplates: false });
  expect(await t.ack(t.command("send"))).toMatchObject({ outcome: "rejected" });
  t.emit("agent_start");
  t.emit("agent_end");
  expect(await t.ack(t.command("send"))).toMatchObject({ outcome: "rejected" });
  expect(await t.ack(t.command("stop"))).toMatchObject({ outcome: "invoked" });
  expect(t.ctx.abort).toHaveBeenCalledOnce();
  t.emit("agent_settled");
  t.setIdle(false);
  expect(await t.ack(t.command("send"))).toMatchObject({ outcome: "rejected" });
  t.setIdle(true);
  expect(await t.ack(t.command("send"))).toMatchObject({ outcome: "invoked" });
});
it("streams provisional thinking/text/tools, then replaces from getBranch after later transformations", async () => {
  const t = await setup();
  const message = {
    role: "assistant",
    timestamp: 2,
    content: [
      { type: "thinking", thinking: "reason" },
      { type: "text", text: "partial" },
    ],
  };
  expect(t.emit("message_update", { message })).toEqual([undefined]);
  t.emit("message_end", { message });
  await vi.waitFor(() =>
    expect(t.latest()?.messages.map((m) => m.text)).toEqual(["reason", "partial"]),
  );
  t.emit("tool_execution_update", {
    toolCallId: "t",
    toolName: "bash",
    partialResult: { content: [{ type: "text", text: "running output" }] },
  });
  await vi.waitFor(() => expect(t.latest()?.messages.at(-1)?.text).toBe("running output"));
  // This persistence happens AFTER message_end, as in Pi 0.99.1.
  t.branch.push({
    type: "message",
    id: "persisted",
    message: { ...message, content: [{ type: "text", text: "transformed" }] },
  });
  t.emit("turn_end");
  await vi.waitFor(() =>
    expect(t.latest()?.messages).toEqual([
      expect.objectContaining({ id: "persisted", text: "transformed" }),
    ]),
  );
});
it("reconnects with a fresh epoch and live overlay, rejecting commands from the old epoch", async () => {
  const t = await setup();
  const initial = t.latest()!;
  t.emit("message_update", {
    message: { role: "assistant", timestamp: 1, content: [{ type: "text", text: "streaming" }] },
  });
  await vi.waitFor(() => expect(t.latest()?.messages[0]?.text).toBe("streaming"));
  t.connections[0].destroy();
  await vi.waitFor(() => expect(t.connections).toHaveLength(2), { timeout: 2000 });
  await vi.waitFor(() => expect(t.latest()?.epoch).not.toBe(initial.epoch));
  expect(t.latest()?.messages[0]?.text).toBe("streaming");
  expect(await t.ack(t.command("send", targetOf(initial)))).toMatchObject({ outcome: "rejected" });
  expect(t.pi.sendUserMessage).not.toHaveBeenCalled();
});
it("cleans up shutdown, prevents duplicate package connections and uses only fresh replacement context", async () => {
  const t = await setup();
  const duplicate = fakePi();
  duplicate.emit("session_start");
  expect(t.connections).toHaveLength(1);
  duplicate.emit("session_shutdown");
  t.emit("session_shutdown");
  await vi.waitFor(() => expect(t.connections[0].destroyed).toBe(true));
  // Invalid old context must never be accessed by a reconnect timer.
  Object.defineProperty(t.ctx, "sessionManager", {
    get: () => {
      throw new Error("old runtime");
    },
  });
  const replacement = fakePi("replacement");
  cleanup.push(() => {
    replacement.emit("session_shutdown");
  });
  replacement.emit("session_start");
  await vi.waitFor(() => expect(t.latest()?.identity.sessionId).toBe("replacement"));
  await new Promise((done) => setTimeout(done, 400));
  expect(t.connections).toHaveLength(2);
});
