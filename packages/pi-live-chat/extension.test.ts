import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile, open } from "node:fs/promises";
import { createServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  ExtensionAPI,
  CompactOptions,
  ExtensionContext,
  ExtensionCommandContext,
  ExtensionToolContext,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { afterEach, expect, it, vi } from "vitest";
import liveChat from "./index.js";
import {
  footerRequestEvent,
  footerUpdateEvent,
  snapshotSchema,
  targetOf,
  type Snapshot,
} from "./protocol.js";
import { receiveFrames, writeFrame } from "./transport.js";
import { boardRequestSchema, type BoardGrant, type BoardRequest } from "./boardProtocol.js";

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
  let activeTools = ["read", "bash"];
  const tools = new Map<string, ToolDefinition>();
  const ctx = {
    mode: "tui",
    cwd: "/test",
    model: { id: "model", provider: "provider" },
    isIdle: () => idle,
    hasPendingMessages: () => false,
    abort: vi.fn(),
    compact: vi.fn(),
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
  const eventHandlers = new Map<string, ((value: unknown) => void)[]>();
  const pi = {
    events: {
      on: (name: string, handler: (value: unknown) => void) => {
        eventHandlers.set(name, [...(eventHandlers.get(name) ?? []), handler]);
        return () =>
          eventHandlers.set(
            name,
            (eventHandlers.get(name) ?? []).filter((h) => h !== handler),
          );
      },
      emit: (name: string, value: unknown) => {
        for (const handler of eventHandlers.get(name) ?? []) handler(value);
      },
    },
    on: (event: string, handler: Handler) => {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    },
    sendUserMessage: vi.fn(),
    registerTool: vi.fn((definition: ToolDefinition) => tools.set(definition.name, definition)),
    getActiveTools: () => [...activeTools],
    setActiveTools: vi.fn((names: string[]) => {
      activeTools = names;
    }),
    registerCommand: (
      name: string,
      command: {
        handler: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
      },
    ) => commands.set(name, command),
    getCommands: vi.fn(() => [...commands.keys()].map((name) => ({ name }))),
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
    tools,
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
  vi.useRealTimers();
});
async function setup(beforeStart?: (pi: ReturnType<typeof fakePi>) => void) {
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
  beforeStart?.(pi);
  expect(pi.emit("session_start")).toEqual([undefined]);
  await vi.waitFor(() => expect(latest()).toBeDefined());
  const command = (
    action: "send" | "stop" | "compact",
    target = targetOf(latest()!),
    text = "hello",
  ) => {
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
it("rejects busy, stale and repeated compaction commands without invoking Pi", async () => {
  const t = await setup();
  t.setIdle(false);
  expect(await t.ack(t.command("compact"))).toMatchObject({
    outcome: "rejected",
    reason: expect.stringContaining("busy"),
  });
  t.setIdle(true);
  expect(
    await t.ack(t.command("compact", { ...targetOf(t.latest()!), epoch: randomUUID() })),
  ).toMatchObject({ outcome: "rejected", reason: expect.stringContaining("Stale") });
  const id = t.command("compact");
  await vi.waitFor(() => expect(t.ctx.compact).toHaveBeenCalledOnce());
  writeFrame(t.connections.at(-1)!, {
    type: "command",
    action: "compact",
    id,
    target: targetOf(t.latest()!),
  });
  expect(await t.ack(id)).toMatchObject({
    outcome: "rejected",
    reason: expect.stringContaining("already seen"),
  });
  expect(t.ctx.compact).toHaveBeenCalledOnce();
});

it("keeps compaction locked across disconnect, never replays, and cannot confirm on the new socket", async () => {
  const t = await setup();
  const id = t.command("compact");
  await vi.waitFor(() => expect(t.ctx.compact).toHaveBeenCalledOnce());
  const options = vi.mocked(t.ctx.compact).mock.calls[0][0]!;
  t.connections.at(-1)!.destroy();
  await vi.waitFor(() => expect(t.connections).toHaveLength(2));
  await vi.waitFor(() => expect(t.latest()?.sendPending).toBe(true));
  expect(await t.ack(t.command("compact"))).toMatchObject({ outcome: "rejected" });
  options.onComplete!({} as Parameters<NonNullable<CompactOptions["onComplete"]>>[0]);
  await vi.waitFor(() => expect(t.latest()?.sendPending).toBe(false));
  expect(t.frames.some((v) => typeof v === "object" && v && "id" in v && v.id === id)).toBe(false);
  expect(t.ctx.compact).toHaveBeenCalledOnce();
});

it("does not report compaction success after a target change or shutdown", async () => {
  const t = await setup();
  const id = t.command("compact");
  await vi.waitFor(() => expect(t.ctx.compact).toHaveBeenCalledOnce());
  const options = vi.mocked(t.ctx.compact).mock.calls[0][0]!;
  t.emit("session_tree");
  options.onComplete!({} as Parameters<NonNullable<CompactOptions["onComplete"]>>[0]);
  expect(await t.ack(id)).toMatchObject({
    outcome: "rejected",
    reason: expect.stringContaining("uncertain"),
  });
  const second = t.command("compact");
  await vi.waitFor(() => expect(t.ctx.compact).toHaveBeenCalledTimes(2));
  t.emit("session_shutdown");
  vi.mocked(t.ctx.compact).mock.calls[1][0]!.onError!(new Error("cancelled"));
  expect(t.frames.some((v) => typeof v === "object" && v && "id" in v && v.id === second)).toBe(
    false,
  );
});

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
  const active = manager.appendMessage({
    role: "user",
    content: "active branch",
    timestamp: 2,
  });
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
    expect(session.getActiveToolNames()).not.toContain("board_read");
    expect(session.getActiveToolNames()).not.toContain("board_apply");
    const treeId = randomUUID();
    writeFrame(t.connections.at(-1)!, {
      type: "command",
      id: treeId,
      target: targetOf(t.latest()!),
      action: "tree",
    });
    const tree = (await t.ack(treeId)) as {
      tree: {
        roots: {
          label?: string;
          children: { id: string; isActivePath: boolean }[];
        }[];
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
    await session.extensionRunner?.emit({
      type: "session_shutdown",
      reason: "quit",
    });
    session.dispose();
  }
}, 20_000);

it.each(["UI", "terminal", "cancel", "abort", "failure"] as const)(
  "tracks real %s compaction through completion or failure",
  async (mode) => {
    const t = await setup();
    t.emit("session_shutdown");
    vi.stubEnv("PI_OFFLINE", "1");
    const { createAgentSession, DefaultResourceLoader, SessionManager, SettingsManager } =
      await import("@earendil-works/pi-coding-agent");
    const manager = SessionManager.create(t.dir, join(t.dir, "sessions"));
    manager.appendMessage({ role: "user", content: "older context ".repeat(100), timestamp: 1 });
    manager.appendMessage({ role: "user", content: "retained context ".repeat(100), timestamp: 2 });
    const settingsManager = SettingsManager.inMemory({ compaction: { keepRecentTokens: 1 } });
    const agentDir = join(t.dir, "isolated-agent");
    let release!: () => void;
    const resourceLoader = new DefaultResourceLoader({
      cwd: t.dir,
      agentDir,
      settingsManager,
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      extensionFactories: [
        liveChat,
        (pi) => {
          pi.on("session_before_compact", async (event) => {
            await new Promise<void>((resolve) => {
              release = resolve;
            });
            if (mode === "cancel") return { cancel: true };
            if (mode === "failure") return;
            return {
              compaction: {
                summary: "Older conversation summarized",
                firstKeptEntryId: event.preparation.firstKeptEntryId,
                tokensBefore: event.preparation.tokensBefore,
              },
            };
          });
        },
      ],
    });
    await resourceLoader.reload();
    const { session } = await createAgentSession({
      cwd: t.dir,
      agentDir,
      resourceLoader,
      settingsManager,
      sessionManager: manager,
      model: {
        id: "fixture",
        name: "Fixture",
        api: "anthropic-messages",
        provider: "anthropic",
        baseUrl: "https://example.invalid",
        contextWindow: 200000,
        maxTokens: 1000,
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      tools: [],
    });
    const stream = vi.fn(() => {
      throw new Error("Provider must not be called");
    });
    session.agent.streamFunction = stream;
    try {
      await session.bindExtensions({ mode: "tui" });
      await vi.waitFor(() => expect(t.latest()?.identity.sessionId).toBe(manager.getSessionId()));
      // session.compact is the same entry point used by terminal /compact.
      const id = mode === "UI" ? t.command("compact") : undefined;
      const result =
        mode === "UI"
          ? undefined
          : session.compact().then(
              () => "success",
              () => "failure",
            );
      await vi.waitFor(() => expect(release).toBeDefined());
      await vi.waitFor(() => expect(t.latest()).toMatchObject({ busy: true, compacting: true }));
      expect(session.isIdle).toBe(false);
      expect(manager.getBranch().some((e) => e.type === "compaction")).toBe(false);
      expect(t.frames.some((v) => typeof v === "object" && v && "id" in v && v.id === id)).toBe(
        false,
      );
      if (mode === "abort") session.abortCompaction();
      release();
      if (id) expect(await t.ack(id)).toMatchObject({ type: "compacted" });
      else expect(await result).toBe(mode === "terminal" ? "success" : "failure");
      expect(manager.getBranch().some((e) => e.type === "compaction")).toBe(
        mode === "UI" || mode === "terminal",
      );
      expect(session.isIdle).toBe(true);
      await vi.waitFor(() =>
        expect(t.latest()).toMatchObject({ busy: false, compacting: false, sendPending: false }),
      );
      if (mode === "UI" || mode === "terminal")
        expect(await t.ack(t.command("compact"))).toMatchObject({
          type: "ack",
          outcome: "rejected",
          reason: "Already compacted",
        });
      if (mode !== "failure") expect(stream).not.toHaveBeenCalled();
    } finally {
      await session.extensionRunner?.emit({ type: "session_shutdown", reason: "quit" });
      session.dispose();
    }
  },
  20_000,
);

it("retains terminal/automatic compaction activity across reconnect and resets it on session replacement", async () => {
  const t = await setup();
  t.emit("session_before_compact", { reason: "threshold" });
  await vi.waitFor(() => expect(t.latest()).toMatchObject({ compacting: true, busy: true }));
  const runtime = t.latest()!.identity.runtime;
  const epoch = t.latest()!.epoch;
  t.connections.at(-1)!.destroy();
  await vi.waitFor(() => expect(t.latest()!.epoch).not.toBe(epoch));
  expect(t.latest()).toMatchObject({ compacting: true, busy: true, identity: { runtime } });
  t.emit("session_start");
  await vi.waitFor(() => expect(t.latest()!.identity.runtime).not.toBe(runtime));
  expect(t.latest()).toMatchObject({ compacting: false, busy: false });
});

it("lists skills on demand while busy and revalidates selected skills before forwarding images", async () => {
  const t = await setup();
  const command = {
    name: "skill:review",
    description: "Review code",
    source: "skill",
    sourceInfo: { path: "/home/.agents/skills/review/SKILL.md", scope: "user" },
  };
  t.pi.getCommands.mockReturnValue([command]);
  t.setIdle(false);
  const id = randomUUID();
  writeFrame(t.connections[0], {
    type: "command",
    id,
    action: "skills",
    target: targetOf(t.latest()!),
  });
  expect(await t.ack(id)).toMatchObject({
    type: "skills",
    skills: [{ name: "review", path: command.sourceInfo.path, scope: "user" }],
  });
  expect(t.latest()?.capabilities?.skills).toBe(true);
  expect(t.pi.sendUserMessage).not.toHaveBeenCalled();
  expect(await t.ack(t.command("send", targetOf(t.latest()!), "/skill:review"))).toMatchObject({
    outcome: "rejected",
  });
  t.setIdle(true);
  t.pi.getCommands.mockReturnValue([]);
  expect(await t.ack(t.command("send", targetOf(t.latest()!), "/skill:review"))).toMatchObject({
    outcome: "rejected",
    reason: expect.stringContaining("unavailable"),
  });
  expect(t.pi.sendUserMessage).not.toHaveBeenCalled();
  t.pi.getCommands.mockReturnValue([command]);
  vi.stubEnv("FERNBLICK_UPLOAD_DIR", t.dir);
  const attachment = `${randomUUID()}.png`;
  await writeFile(join(t.dir, attachment), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), {
    mode: 0o600,
  });
  const sendId = randomUUID();
  writeFrame(t.connections[0], {
    type: "command",
    id: sendId,
    action: "send",
    target: targetOf(t.latest()!),
    text: "/skill:review\ncheck this",
    attachments: [attachment],
  });
  expect(await t.ack(sendId)).toMatchObject({ outcome: "invoked" });
  expect(t.pi.sendUserMessage).toHaveBeenCalledWith(
    [
      { type: "text", text: "/skill:review check this" },
      expect.objectContaining({ type: "image", mimeType: "image/png" }),
    ],
    { expandPromptTemplates: true },
  );
});

it("keeps ordinary slash messages literal", async () => {
  const t = await setup();
  expect(await t.ack(t.command("send", targetOf(t.latest()!), "/reload"))).toMatchObject({
    outcome: "invoked",
  });
  expect(t.pi.sendUserMessage).toHaveBeenCalledWith("/reload", { expandPromptTemplates: false });
});

it("acknowledges forwarding without text matching and gates further sends using native working/idle events", async () => {
  const t = await setup();
  const id = t.command("send");
  expect(await t.ack(id)).toMatchObject({ outcome: "invoked" });
  await vi.waitFor(() => expect(t.latest()?.sendPending).toBe(true));
  expect(await t.ack(t.command("send"))).toMatchObject({ outcome: "rejected" });
  t.setIdle(false);
  t.emit("agent_start");
  t.emit("message_start", {
    message: {
      role: "user",
      content: "hello\n\n[Image dimension note or arbitrary transformation]",
      timestamp: 2,
    },
  });
  await vi.waitFor(() => expect(t.latest()?.sendPending).toBe(false));
  expect(t.latest()?.busy).toBe(true);
  expect(t.latest()).not.toHaveProperty("receivedSendIds");
  expect(await t.ack(t.command("send"))).toMatchObject({ outcome: "rejected" });
  t.setIdle(true);
  t.emit("agent_settled");
  await vi.waitFor(() => expect(t.latest()?.busy).toBe(false));
  expect(await t.ack(t.command("send", targetOf(t.latest()!), "next"))).toMatchObject({
    outcome: "invoked",
  });
});
it("does not invoke Pi twice if a transport repeats the same request ID", async () => {
  const t = await setup();
  const id = t.command("send");
  expect(await t.ack(id)).toMatchObject({ outcome: "invoked" });
  writeFrame(t.connections.at(-1)!, {
    type: "command",
    action: "send",
    target: targetOf(t.latest()!),
    id,
    text: "hello",
  });
  await vi.waitFor(() =>
    expect(t.frames.filter((frame) => (frame as { id?: string }).id === id)).toHaveLength(2),
  );
  expect(t.frames.filter((frame) => (frame as { id?: string }).id === id).at(-1)).toMatchObject({
    outcome: "rejected",
    reason: "Command already seen; never retried",
  });
  expect(t.pi.sendUserMessage).toHaveBeenCalledOnce();
});
it("bounds the handoff guard when Pi emits no run events, without retrying", async () => {
  const t = await setup();
  vi.useFakeTimers();
  expect(await t.ack(t.command("send"))).toMatchObject({ outcome: "invoked" });
  await vi.waitFor(() => expect(t.latest()?.sendPending).toBe(true));
  await vi.advanceTimersByTimeAsync(15_050);
  await vi.waitFor(() => expect(t.latest()?.sendPending).toBe(false));
  expect(t.latest()?.busy).toBe(false);
  expect(t.pi.sendUserMessage).toHaveBeenCalledOnce();
});

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
    void t.commands.get(name)!.handler(nonce, {
      ...t.ctx,
      navigateTree,
    } as unknown as ExtensionCommandContext);
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
  expect(boardRequests(t)).toEqual([]);
  expect(t.pi.getActiveTools()).not.toContain("board_read");
  const message = { role: "user", timestamp: 55, content };
  t.emit("message_start", { message });
  t.branch.push({
    type: "message",
    id: "persisted-images",
    parentId: null,
    message,
  });
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

it.each(["epoch", "session", "busy", "input", "stop"] as const)(
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
      board: {
        boardId: "a".repeat(64),
        grantId: randomUUID(),
        mode: "edit",
        revision: 0,
      },
    });
    await started;
    if (change === "epoch") t.emit("session_tree");
    else if (change === "session") t.emit("session_shutdown");
    else if (change === "input") t.emit("input", { text: "unrelated", source: "interactive" });
    else if (change === "stop")
      expect(await t.ack(t.command("stop"))).toMatchObject({
        outcome: "invoked",
      });
    else t.setIdle(false);
    release();
    if (change !== "session") expect(await t.ack(id)).toMatchObject({ outcome: "rejected" });
    else await new Promise((done) => setTimeout(done, 50));
    expect(t.pi.sendUserMessage).not.toHaveBeenCalled();
    expect(boardRequests(t)).toEqual([]);
    expect(t.pi.getActiveTools()).not.toContain("board_read");
  },
);

it("rejects missing handlers, busy and missing entries without navigating or leaking tokens", async () => {
  const t = await setup();
  const navigateTree = vi.fn();
  t.pi.sendUserMessage.mockImplementation((text) => {
    const [name, nonce] = (text as string).slice(1).split(" ");
    void t.commands.get(name)!.handler(nonce, {
      ...t.ctx,
      navigateTree,
    } as unknown as ExtensionCommandContext);
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
  expect(
    t.emit("input", {
      text: "/fernblick-bridge-expired nonce",
      source: "extension",
    }),
  ).toEqual([{ action: "handled" }]);
});

it("uses void send/abort, rejects busy and concurrent sends, and waits for settled not agent_end", async () => {
  const t = await setup();
  expect(await t.ack(t.command("send"))).toMatchObject({ outcome: "invoked" });
  expect(t.pi.sendUserMessage).toHaveBeenCalledWith("hello", {
    expandPromptTemplates: false,
  });
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
    message: {
      role: "assistant",
      timestamp: 1,
      content: [{ type: "text", text: "streaming" }],
    },
  });
  await vi.waitFor(() => expect(t.latest()?.messages[0]?.text).toBe("streaming"));
  t.connections[0].destroy();
  await vi.waitFor(() => expect(t.connections).toHaveLength(2), {
    timeout: 2000,
  });
  await vi.waitFor(() => expect(t.latest()?.epoch).not.toBe(initial.epoch));
  expect(t.latest()?.messages[0]?.text).toBe("streaming");
  expect(await t.ack(t.command("send", targetOf(initial)))).toMatchObject({
    outcome: "rejected",
  });
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

async function stageBoard(
  t: Awaited<ReturnType<typeof setup>>,
  mode: BoardGrant["mode"] = "edit",
  attachments: string[] = [],
) {
  const board: BoardGrant = {
    boardId: "a".repeat(64),
    grantId: randomUUID(),
    mode,
    revision: 0,
  };
  const id = randomUUID();
  writeFrame(t.connections.at(-1)!, {
    type: "command",
    id,
    action: "send",
    target: targetOf(t.latest()!),
    text: "Update this board",
    board,
    attachments,
  });
  expect(await t.ack(id)).toMatchObject({ outcome: "invoked" });
  return board;
}
function boardRequests(t: Awaited<ReturnType<typeof setup>>) {
  return t.frames.filter((frame) => boardRequestSchema.safeParse(frame).success) as BoardRequest[];
}
async function activateBoard(
  t: Awaited<ReturnType<typeof setup>>,
  mode: BoardGrant["mode"] = "edit",
  attachments: string[] = [],
) {
  const board = await stageBoard(t, mode, attachments);
  t.emit("input", { text: "Update this board", source: "extension" });
  const before = Promise.all(
    t.emit("before_agent_start", {
      prompt: "Update this board",
      systemPrompt: "Base and other extension instructions",
      images: attachments.length
        ? [{ type: "image", mimeType: "image/png", data: "fixture" }]
        : undefined,
    }),
  );
  await vi.waitFor(() => expect(boardRequests(t).at(-1)?.action).toBe("activate"));
  expect(t.pi.getActiveTools()).not.toContain("board_read");
  writeFrame(t.connections.at(-1)!, {
    type: "board-reply",
    id: boardRequests(t).at(-1)!.id,
    ok: true,
  });
  const results = (await before).filter(Boolean);
  expect(results).toEqual([
    {
      systemPrompt: expect.stringContaining("Base and other extension instructions\n\nWhiteboard"),
    },
  ]);
  expect(results[0]).not.toHaveProperty("message");
  if (attachments.length)
    expect(results[0]).toMatchObject({
      systemPrompt: expect.stringContaining("The attached image shows the board"),
    });
  else
    expect(results[0]).toMatchObject({
      systemPrompt: expect.not.stringContaining("The attached image shows the board"),
    });
  return board;
}

it("delivers visual board content to Pi while activating request-scoped edit tools", async () => {
  const t = await setup();
  vi.stubEnv("FERNBLICK_UPLOAD_DIR", t.dir);
  const uploadId = randomUUID() + ".png";
  const bytes = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
    "base64",
  );
  await writeFile(join(t.dir, uploadId), bytes, { mode: 0o600 });
  const board = await activateBoard(t, "edit", [uploadId]);
  expect(t.pi.sendUserMessage).toHaveBeenCalledOnce();
  expect(t.pi.sendUserMessage.mock.calls[0][0]).toEqual([
    { type: "text", text: "Update this board" },
    { type: "image", mimeType: "image/png", data: bytes.toString("base64") },
  ]);
  expect(JSON.stringify(t.pi.sendUserMessage.mock.calls)).not.toContain(board.grantId);
  expect(t.pi.getActiveTools()).toEqual(["read", "bash", "board_read", "board_apply"]);
  t.emit("agent_start");
  t.emit("agent_settled");
  expect(t.pi.getActiveTools()).toEqual(["read", "bash"]);
});
it("advertises boards, dispatches private RPCs before commands, and gates read-only tools until matching activation", async () => {
  const t = await setup();
  expect(t.latest()?.capabilities).toEqual({ boards: true, skills: true, compact: true });
  expect(t.tools.get("board_read")).toMatchObject({
    exposure: "hidden",
    defaultActive: false,
  });
  expect(t.pi.getActiveTools()).toEqual(["read", "bash"]);
  const board = await activateBoard(t, "read");
  expect(t.pi.getActiveTools()).toEqual(["read", "bash", "board_read"]);
  expect(t.tools.get("board_apply")?.exposure).toBe("hidden");
  expect(JSON.stringify(t.pi.sendUserMessage.mock.calls)).not.toContain(board.grantId);
  t.emit("agent_start");
  const read = t.tools
    .get("board_read")!
    .execute("read", { limit: 4 }, undefined, undefined, t.ctx as ExtensionToolContext);
  await vi.waitFor(() => expect(boardRequests(t).at(-1)?.action).toBe("read"));
  const request = boardRequests(t).at(-1)!;
  expect(request).toMatchObject({
    target: targetOf(t.latest()!),
    grantId: board.grantId,
    boardId: board.boardId,
    offset: 0,
    limit: 4,
  });
  writeFrame(t.connections.at(-1)!, {
    type: "board-reply",
    id: request.id,
    ok: true,
    data: { revision: 0, elements: [] },
  });
  expect(await read).toMatchObject({
    content: [{ type: "text", text: expect.stringContaining("revision") }],
  });
  t.emit("agent_end");
  expect(t.pi.getActiveTools()).toContain("board_read");
  t.emit("agent_settled");
  expect(t.pi.getActiveTools()).not.toContain("board_read");
  expect(t.tools.get("board_read")?.exposure).toBe("hidden");
  await vi.waitFor(() => expect(boardRequests(t).at(-1)?.action).toBe("revoke"));
});

it.each([
  "input",
  "session_tree",
  "session_before_switch",
  "session_before_fork",
  "session_before_compact",
  "session_shutdown",
  "stop",
  "disconnect",
  "backend",
])("withdraws tools promptly on %s and does not await revoke replies", async (event) => {
  const t = await setup();
  const board = await activateBoard(t);
  t.emit("agent_start");
  if (event === "input") t.emit("input", { text: "Update this board", source: "interactive" });
  else if (event === "stop")
    expect(await t.ack(t.command("stop"))).toMatchObject({
      outcome: "invoked",
    });
  else if (event === "disconnect") t.connections.at(-1)!.destroy();
  else if (event === "backend")
    writeFrame(t.connections.at(-1)!, {
      type: "board-revoke",
      grantId: board.grantId,
    });
  else t.emit(event);
  await vi.waitFor(() => expect(t.pi.getActiveTools()).not.toContain("board_read"));
  expect(t.tools.get("board_apply")?.exposure).toBe("hidden");
  await expect(
    t.tools
      .get("board_read")!
      .execute("stale", {}, undefined, undefined, t.ctx as ExtensionToolContext),
  ).rejects.toThrow("No active");
});

it("a duplicate load neither registers replacements nor disables the active owner's tools", async () => {
  const t = await setup();
  await activateBoard(t);
  const count = t.pi.registerTool.mock.calls.length;
  const duplicate = fakePi();
  duplicate.emit("session_start");
  duplicate.emit("input", { text: "unrelated", source: "interactive" });
  duplicate.emit("agent_settled");
  duplicate.emit("session_shutdown");
  expect(duplicate.pi.registerTool).not.toHaveBeenCalled();
  expect(duplicate.pi.setActiveTools).not.toHaveBeenCalled();
  expect(t.pi.registerTool).toHaveBeenCalledTimes(count);
  expect(t.pi.getActiveTools()).toContain("board_apply");
});

it("requests footer replay on startup/reconnect and forwards session-bound updates through the real socket", async () => {
  const lines = ["\x1b[38;2;246;226;183mreal footer high\x1b[0m", "\x1b[2m↑20k $1.234\x1b[0m"];
  const replay = vi.fn();
  const t = await setup(({ pi, ctx }) => {
    pi.events.on(footerRequestEvent, (request) => {
      replay(request);
      pi.events.emit(footerUpdateEvent, { version: 1, ...(request as object), lines });
    });
    expect(ctx.mode).toBe("tui");
  });
  expect(replay).toHaveBeenCalledWith({ sessionId: "session", sessionFile: "/session.jsonl" });
  expect(t.latest()?.status.footerLines).toEqual(lines);
  const next = ["Branch changed", "Fresh limits and extension status"];
  t.pi.events.emit(footerUpdateEvent, {
    version: 1,
    sessionId: "session",
    sessionFile: "/session.jsonl",
    lines: next,
  });
  await vi.waitFor(() => expect(t.latest()?.status.footerLines).toEqual(next));
  t.pi.events.emit(footerUpdateEvent, {
    version: 1,
    sessionId: "old",
    sessionFile: "/session.jsonl",
    lines: ["stale"],
  });
  t.pi.events.emit(footerUpdateEvent, {
    version: 1,
    sessionId: "session",
    sessionFile: "/old.jsonl",
    lines: ["stale"],
  });
  t.pi.events.emit(footerUpdateEvent, {
    version: 1,
    sessionId: "session",
    sessionFile: "/session.jsonl",
    lines: ["x".repeat(8193)],
  });
  t.emit("message_update", { message: { role: "assistant", content: "new", id: "m" } });
  await new Promise((r) => setTimeout(r, 100));
  expect(t.latest()?.status.footerLines).toEqual(next);
  t.connections.at(-1)!.destroy();
  await vi.waitFor(() => expect(t.connections.length).toBe(2));
  await vi.waitFor(() => expect(t.latest()?.status.footerLines).toEqual(lines));
  expect(replay.mock.calls.length).toBeGreaterThanOrEqual(3);
});

it("falls back without a publisher, clears on withdrawal/context change, and never inherits footer state on replacement", async () => {
  const t = await setup();
  expect(t.latest()?.status.footerLines).toBeUndefined();
  const publication = {
    version: 1,
    sessionId: "session",
    sessionFile: "/session.jsonl",
    lines: ["current"],
  };
  t.pi.events.emit(footerUpdateEvent, publication);
  await vi.waitFor(() => expect(t.latest()?.status.footerLines).toEqual(["current"]));
  t.pi.events.emit(footerUpdateEvent, { ...publication, lines: null });
  await vi.waitFor(() => expect(t.latest()?.status.footerLines).toBeUndefined());
  t.pi.events.emit(footerUpdateEvent, publication);
  await vi.waitFor(() => expect(t.latest()?.status.footerLines).toEqual(["current"]));
  t.emit("thinking_level_select");
  await vi.waitFor(() => expect(t.latest()?.status.footerLines).toBeUndefined());
  t.pi.events.emit(footerUpdateEvent, publication);
  await vi.waitFor(() => expect(t.latest()?.status.footerLines).toEqual(["current"]));
  t.emit("session_shutdown");
  t.pi.events.emit(footerUpdateEvent, publication);
  const replacement = fakePi("replacement");
  cleanup.push(() => {
    replacement.emit("session_shutdown");
  });
  replacement.emit("session_start");
  await vi.waitFor(() => expect(t.latest()?.identity.sessionId).toBe("replacement"));
  expect(t.latest()?.status.footerLines).toBeUndefined();
  replacement.pi.events.emit(footerUpdateEvent, publication);
  replacement.emit("model_select");
  await new Promise((r) => setTimeout(r, 100));
  expect(t.latest()?.status.footerLines).toBeUndefined();
});
