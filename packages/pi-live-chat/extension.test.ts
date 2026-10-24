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
import { globalDefaultInfo, saveGlobalDefault } from "./globalDefaults.js";
vi.mock("./globalDefaults.js", () => ({
  saveGlobalDefault: vi.fn(async () => {}),
  globalDefaultInfo: vi.fn(),
}));
import {
  footerRequestEvent,
  footerUpdateEvent,
  snapshotSchema,
  treePageResponseSchema,
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
  let thinkingLevel = "medium";
  let activeTools = ["read", "bash"];
  const tools = new Map<string, ToolDefinition>();
  const ctx = {
    mode: "tui",
    cwd: "/test",
    model: { id: "model", provider: "provider", reasoning: true },
    modelRegistry: {
      getAvailable: vi.fn(() => [{ id: "model", provider: "provider", name: "Test model" }]),
    },
    isIdle: () => idle,
    hasPendingMessages: () => false,
    abort: vi.fn(),
    compact: vi.fn(),
    shutdown: vi.fn(),
    ui: { getEditorText: vi.fn(() => ""), setEditorText: vi.fn() },
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
    getThinkingLevel: vi.fn(() => thinkingLevel),
    setThinkingLevel: vi.fn((level: string) => {
      thinkingLevel = level;
    }),
    setModel: vi.fn(async (model: unknown) => {
      Object.assign(ctx, { model });
      return true;
    }),
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
  vi.mocked(saveGlobalDefault).mockReset().mockResolvedValue(undefined);
  vi.mocked(globalDefaultInfo)
    .mockReset()
    .mockReturnValue({
      defaults: { model: null, thinkingLevel: null },
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
    action: "send" | "stop" | "compact" | "shutdown",
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
it.each(["Old draft", "  ", "Line one\nLine two", "[Image attachment]"])(
  "refuses shutdown without submitting or discarding editor text: %j",
  async (draft) => {
    const t = await setup();
    vi.mocked(t.ctx.ui.getEditorText).mockReturnValue(draft);
    expect(await t.ack(t.command("shutdown"))).toMatchObject({
      type: "ack",
      outcome: "rejected",
      reason: expect.stringContaining("unsent draft"),
    });
    expect(t.ctx.shutdown).not.toHaveBeenCalled();
    expect(t.ctx.ui.setEditorText).not.toHaveBeenCalled();
    expect(t.pi.sendUserMessage).not.toHaveBeenCalled();
    expect(t.branch).toEqual([]);
  },
);

it("requests orderly shutdown once with correlated confirmation, never a prompt", async () => {
  const t = await setup();
  const target = targetOf(t.latest()!);
  const id = t.command("shutdown");
  expect(await t.ack(id)).toMatchObject({ type: "shutdown-requested", id, target });
  expect(t.ctx.shutdown).toHaveBeenCalledOnce();
  expect(await t.ack(t.command("send"))).toMatchObject({
    outcome: "rejected",
    reason: "Pi is shutting down",
  });
  expect(await t.ack(t.command("shutdown"))).toMatchObject({ outcome: "rejected" });
  expect(t.pi.sendUserMessage).not.toHaveBeenCalled();
  expect(t.ctx.ui.setEditorText).not.toHaveBeenCalled();
  expect(t.branch).toEqual([]);
});

it("delivers shutdown confirmation even when cleanup closes the socket immediately", async () => {
  const t = await setup();
  vi.mocked(t.ctx.shutdown).mockImplementation(() => {
    t.emit("session_shutdown");
  });
  expect(await t.ack(t.command("shutdown"))).toMatchObject({ type: "shutdown-requested" });
  expect(t.ctx.shutdown).toHaveBeenCalledOnce();
});

it.each(["busy", "queued", "send-pending", "stale", "unreadable-editor"])(
  "refuses unsafe shutdown: %s",
  async (condition) => {
    const t = await setup();
    if (condition === "busy") t.setIdle(false);
    if (condition === "queued") t.ctx.hasPendingMessages = () => true;
    if (condition === "send-pending") await t.ack(t.command("send"));
    if (condition === "unreadable-editor")
      vi.mocked(t.ctx.ui.getEditorText).mockImplementation(() => {
        throw new Error("Editor unavailable");
      });
    const target = targetOf(t.latest()!);
    if (condition === "stale") target.epoch = randomUUID();
    expect(await t.ack(t.command("shutdown", target))).toMatchObject({
      type: "ack",
      outcome: "rejected",
    });
    expect(t.ctx.shutdown).not.toHaveBeenCalled();
    expect(t.ctx.ui.setEditorText).not.toHaveBeenCalled();
    expect(t.pi.sendUserMessage).toHaveBeenCalledTimes(condition === "send-pending" ? 1 : 0);
  },
);

function defaultCommand(
  t: Awaited<ReturnType<typeof setup>>,
  selection: object = { kind: "model", provider: "provider", modelId: "model" },
  target = targetOf(t.latest()!),
) {
  const id = randomUUID();
  writeFrame(t.connections.at(-1)!, {
    type: "command",
    id,
    action: "save-default",
    target,
    selection,
  });
  return id;
}
it("saves any available model or supported level without switching the current session or prompting", async () => {
  const t = await setup();
  vi.mocked(t.ctx.modelRegistry.getAvailable).mockReturnValue([
    { ...t.ctx.model!, id: "other", provider: "other-provider", name: "Other" },
  ]);
  expect(t.latest()?.capabilities?.defaults).toBe(true);
  for (const selection of [
    { kind: "model", provider: "other-provider", modelId: "other" },
    { kind: "thinking", provider: "provider", modelId: "model", level: "high" },
  ]) {
    const id = defaultCommand(t, selection);
    expect(await t.ack(id)).toEqual({
      type: "default-saved",
      id,
      target: targetOf(t.latest()!),
      selection,
    });
    expect(saveGlobalDefault).toHaveBeenLastCalledWith("/test", selection);
  }
  expect(t.ctx.model?.id).toBe("model");
  expect(t.pi.getThinkingLevel()).toBe("medium");
  expect(t.pi.setModel).not.toHaveBeenCalled();
  expect(t.pi.setThinkingLevel).not.toHaveBeenCalled();
  expect(t.pi.sendUserMessage).not.toHaveBeenCalled();
});
it("rejects busy, stale, model-mismatched, unavailable and unsupported default saves", async () => {
  const t = await setup();
  t.setIdle(false);
  expect(await t.ack(defaultCommand(t))).toMatchObject({
    outcome: "rejected",
    reason: expect.stringContaining("busy"),
  });
  t.setIdle(true);
  expect(
    await t.ack(defaultCommand(t, undefined, { ...targetOf(t.latest()!), epoch: randomUUID() })),
  ).toMatchObject({ outcome: "rejected" });
  expect(
    await t.ack(defaultCommand(t, { kind: "model", provider: "other", modelId: "model" })),
  ).toMatchObject({ outcome: "rejected", reason: expect.stringContaining("no longer available") });
  expect(
    await t.ack(
      defaultCommand(t, {
        kind: "thinking",
        provider: "provider",
        modelId: "changed-model",
        level: "high",
      }),
    ),
  ).toMatchObject({
    outcome: "rejected",
    reason: expect.stringContaining("Model changed"),
  });
  Object.assign(t.ctx, { model: { ...t.ctx.model, reasoning: false } });
  expect(
    await t.ack(
      defaultCommand(t, {
        kind: "thinking",
        provider: "provider",
        modelId: "model",
        level: "medium",
      }),
    ),
  ).toMatchObject({ outcome: "rejected", reason: expect.stringContaining("not supported") });
  vi.mocked(t.ctx.modelRegistry.getAvailable).mockReturnValue([]);
  expect(await t.ack(defaultCommand(t))).toMatchObject({
    outcome: "rejected",
    reason: expect.stringContaining("no longer available"),
  });
  expect(saveGlobalDefault).not.toHaveBeenCalled();
});
it("includes fresh persisted global defaults in both catalogues without changing the session", async () => {
  const t = await setup();
  const defaults = {
    model: { provider: "other", modelId: "other" },
    thinkingLevel: "high" as const,
  };
  vi.mocked(globalDefaultInfo).mockReturnValue({ defaults });
  expect(await t.ack(modelCommand(t, "models"))).toMatchObject({ type: "models", defaults });
  expect(await t.ack(thinkingCommand(t, "thinking-levels"))).toMatchObject({
    type: "thinking-levels",
    defaults,
  });
  expect(globalDefaultInfo).toHaveBeenCalledTimes(2);
  expect(globalDefaultInfo).toHaveBeenLastCalledWith("/test");
  vi.mocked(globalDefaultInfo).mockReturnValue({ defaultsError: "Global defaults unavailable" });
  expect(await t.ack(modelCommand(t, "models"))).toMatchObject({
    type: "models",
    models: [{ id: "model" }],
    defaultsError: "Global defaults unavailable",
  });
  expect(await t.ack(thinkingCommand(t, "thinking-levels"))).toMatchObject({
    type: "thinking-levels",
    level: "medium",
    defaultsError: "Global defaults unavailable",
  });
  expect(saveGlobalDefault).not.toHaveBeenCalled();
  expect(t.pi.setModel).not.toHaveBeenCalled();
  expect(t.pi.setThinkingLevel).not.toHaveBeenCalled();
});
it("confirms only after persistence, serializes requests, rejects duplicates and surfaces write failures", async () => {
  const t = await setup();
  let finish!: () => void;
  vi.mocked(saveGlobalDefault).mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const id = defaultCommand(t);
  await vi.waitFor(() => expect(saveGlobalDefault).toHaveBeenCalledOnce());
  expect(t.frames.some((frame) => (frame as { id?: string }).id === id)).toBe(false);
  expect(await t.ack(defaultCommand(t))).toMatchObject({
    outcome: "rejected",
    reason: expect.stringContaining("in flight"),
  });
  finish();
  expect(await t.ack(id)).toMatchObject({ type: "default-saved" });
  writeFrame(t.connections.at(-1)!, {
    type: "command",
    id,
    action: "save-default",
    target: targetOf(t.latest()!),
    selection: { kind: "model", provider: "provider", modelId: "model" },
  });
  await vi.waitFor(() =>
    expect(t.frames).toContainEqual(expect.objectContaining({ id, outcome: "rejected" })),
  );
  vi.mocked(saveGlobalDefault).mockRejectedValueOnce(new Error("Settings write failed"));
  expect(await t.ack(defaultCommand(t))).toMatchObject({
    outcome: "rejected",
    reason: "Settings write failed",
  });
  expect(saveGlobalDefault).toHaveBeenCalledTimes(2);
});
it("does not confirm a default save after shutdown", async () => {
  const t = await setup();
  let finish!: () => void;
  vi.mocked(saveGlobalDefault).mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const id = defaultCommand(t);
  await vi.waitFor(() => expect(saveGlobalDefault).toHaveBeenCalledOnce());
  t.emit("session_shutdown");
  finish();
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(t.frames.some((frame) => (frame as { id?: string }).id === id)).toBe(false);
});
function modelCommand(
  t: Awaited<ReturnType<typeof setup>>,
  action: "models" | "set-model",
  selection = { provider: "provider", modelId: "model" },
  target = targetOf(t.latest()!),
) {
  const id = randomUUID();
  writeFrame(t.connections.at(-1)!, { type: "command", id, action, target, ...selection });
  return id;
}
function thinkingCommand(
  t: Awaited<ReturnType<typeof setup>>,
  action: "thinking-levels" | "set-thinking-level",
  selection = { provider: "provider", modelId: "model", level: "high" },
  target = targetOf(t.latest()!),
) {
  const id = randomUUID();
  writeFrame(t.connections.at(-1)!, { type: "command", id, action, target, ...selection });
  return id;
}
it("discovers host-supported thinking levels without mutating and projects the current level", async () => {
  const t = await setup();
  expect(t.latest()?.capabilities?.thinking).toBe(true);
  expect(t.latest()?.status.thinkingLevel).toBe("medium");
  Object.assign(t.ctx, {
    model: {
      id: "model",
      provider: "provider",
      reasoning: true,
      thinkingLevelMap: { off: null, minimal: null, xhigh: "very-high", max: "maximum" },
    },
  });
  t.setIdle(false);
  expect(await t.ack(thinkingCommand(t, "thinking-levels"))).toMatchObject({
    type: "thinking-levels",
    provider: "provider",
    modelId: "model",
    level: "medium",
    levels: ["low", "medium", "high", "xhigh", "max"],
  });
  expect(t.pi.setThinkingLevel).not.toHaveBeenCalled();
  Object.assign(t.ctx, { model: { id: "model", provider: "provider", reasoning: false } });
  expect(await t.ack(thinkingCommand(t, "thinking-levels"))).toMatchObject({ levels: ["off"] });
});
it("changes thinking through Pi, confirms effective state, and rejects duplicate IDs", async () => {
  const t = await setup();
  const id = thinkingCommand(t, "set-thinking-level");
  expect(await t.ack(id)).toMatchObject({
    type: "thinking-level-changed",
    target: targetOf(t.latest()!),
    provider: "provider",
    modelId: "model",
    level: "high",
  });
  expect(t.pi.setThinkingLevel).toHaveBeenCalledExactlyOnceWith("high");
  await vi.waitFor(() => expect(t.latest()?.status.thinkingLevel).toBe("high"));
  writeFrame(t.connections.at(-1)!, {
    type: "command",
    id,
    action: "set-thinking-level",
    target: targetOf(t.latest()!),
    provider: "provider",
    modelId: "model",
    level: "high",
  });
  await vi.waitFor(() =>
    expect(t.frames).toContainEqual(
      expect.objectContaining({ id, reason: expect.stringContaining("already seen") }),
    ),
  );
  expect(t.pi.setThinkingLevel).toHaveBeenCalledOnce();
  expect(t.pi.sendUserMessage).not.toHaveBeenCalled();
});
it("rejects busy, stale, model-replaced and unsupported thinking selections without invoking Pi", async () => {
  const t = await setup();
  t.setIdle(false);
  expect(await t.ack(thinkingCommand(t, "set-thinking-level"))).toMatchObject({
    outcome: "rejected",
    reason: expect.stringContaining("busy"),
  });
  t.setIdle(true);
  expect(
    await t.ack(
      thinkingCommand(t, "set-thinking-level", undefined, {
        ...targetOf(t.latest()!),
        epoch: randomUUID(),
      }),
    ),
  ).toMatchObject({ outcome: "rejected" });
  expect(
    await t.ack(
      thinkingCommand(t, "set-thinking-level", {
        provider: "other",
        modelId: "model",
        level: "high",
      }),
    ),
  ).toMatchObject({ outcome: "rejected", reason: expect.stringContaining("Model changed") });
  expect(
    await t.ack(
      thinkingCommand(t, "set-thinking-level", {
        provider: "provider",
        modelId: "model",
        level: "max",
      }),
    ),
  ).toMatchObject({ outcome: "rejected", reason: expect.stringContaining("not supported") });
  expect(t.pi.setThinkingLevel).not.toHaveBeenCalled();
  t.pi.setThinkingLevel.mockImplementationOnce(() => {});
  expect(await t.ack(thinkingCommand(t, "set-thinking-level"))).toMatchObject({
    outcome: "rejected",
    reason: expect.stringContaining("uncertain"),
  });
  t.pi.setThinkingLevel.mockImplementationOnce(() => {
    throw new Error("Thinking setter failed");
  });
  expect(await t.ack(thinkingCommand(t, "set-thinking-level"))).toMatchObject({
    outcome: "rejected",
    reason: "Thinking setter failed",
  });
});
it("serializes thinking requests with pending model changes", async () => {
  const t = await setup();
  let finish!: (value: boolean) => void;
  t.pi.setModel.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const id = modelCommand(t, "set-model");
  await vi.waitFor(() => expect(t.pi.setModel).toHaveBeenCalledOnce());
  expect(await t.ack(thinkingCommand(t, "set-thinking-level"))).toMatchObject({
    outcome: "rejected",
    reason: expect.stringContaining("in flight"),
  });
  expect(t.pi.setThinkingLevel).not.toHaveBeenCalled();
  finish(true);
  await t.ack(id);
});
it("lists bounded display-only model metadata from this session without invoking a model", async () => {
  const t = await setup();
  const getAvailable = vi.mocked(t.ctx.modelRegistry.getAvailable);
  getAvailable.mockReturnValue(
    Array.from({ length: 1001 }, (_, i) => ({
      id: `model-${i}`,
      name: `Model ${i}`,
      provider: "provider",
      apiKey: "secret",
      baseUrl: "private",
      headers: { Authorization: "secret" },
    })) as unknown as ReturnType<typeof getAvailable>,
  );
  t.setIdle(false); // Discovery itself is read-only and allowed while busy.
  const reply = (await t.ack(modelCommand(t, "models"))) as {
    models: unknown[];
    truncated: boolean;
  };
  expect(reply.models).toHaveLength(1000);
  expect(reply.models[0]).toEqual({ id: "model-0", provider: "provider", name: "Model 0" });
  expect(reply.truncated).toBe(true);
  expect(t.pi.setModel).not.toHaveBeenCalled();
  expect(t.pi.sendUserMessage).not.toHaveBeenCalled();
});
it("changes only an available model using Pi and confirms its resulting session state", async () => {
  const t = await setup();
  t.branch.push({
    type: "message",
    id: "keep",
    message: { role: "user", content: "Keep history" },
  });
  const id = modelCommand(t, "set-model");
  expect(await t.ack(id)).toMatchObject({
    type: "model-changed",
    target: targetOf(t.latest()!),
    model: { id: "model", provider: "provider", name: "Test model" },
  });
  expect(t.pi.setModel).toHaveBeenCalledOnce();
  expect(t.branch).toHaveLength(1);
  expect(t.pi.sendUserMessage).not.toHaveBeenCalled();
  writeFrame(t.connections.at(-1)!, {
    type: "command",
    id,
    action: "set-model",
    target: targetOf(t.latest()!),
    provider: "provider",
    modelId: "model",
  });
  await vi.waitFor(() =>
    expect(t.frames).toContainEqual(
      expect.objectContaining({ id, reason: expect.stringContaining("already seen") }),
    ),
  );
  expect(t.pi.setModel).toHaveBeenCalledOnce();
});
it("rejects busy, stale, unknown and unauthenticated model switches", async () => {
  const t = await setup();
  t.setIdle(false);
  expect(await t.ack(modelCommand(t, "set-model"))).toMatchObject({
    outcome: "rejected",
    reason: expect.stringContaining("busy"),
  });
  t.setIdle(true);
  expect(
    await t.ack(
      modelCommand(t, "set-model", undefined, { ...targetOf(t.latest()!), epoch: randomUUID() }),
    ),
  ).toMatchObject({ outcome: "rejected" });
  expect(
    await t.ack(modelCommand(t, "set-model", { provider: "other", modelId: "model" })),
  ).toMatchObject({ outcome: "rejected", reason: expect.stringContaining("no longer available") });
  expect(t.pi.setModel).not.toHaveBeenCalled();
  t.pi.setModel.mockResolvedValueOnce(false);
  expect(await t.ack(modelCommand(t, "set-model"))).toMatchObject({
    outcome: "rejected",
    reason: expect.stringContaining("authentication"),
  });
  t.pi.setModel.mockRejectedValueOnce(new Error("Provider unavailable"));
  expect(await t.ack(modelCommand(t, "set-model"))).toMatchObject({
    outcome: "rejected",
    reason: "Provider unavailable",
  });
});
it("serializes asynchronous model switches and never confirms after shutdown", async () => {
  const t = await setup();
  let finish!: (value: boolean) => void;
  t.pi.setModel.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const id = modelCommand(t, "set-model");
  await vi.waitFor(() => expect(t.pi.setModel).toHaveBeenCalledOnce());
  expect(await t.ack(modelCommand(t, "set-model"))).toMatchObject({
    outcome: "rejected",
    reason: expect.stringContaining("in flight"),
  });
  expect(await t.ack(t.command("send"))).toMatchObject({
    outcome: "rejected",
    reason: expect.stringContaining("in flight"),
  });
  t.emit("session_shutdown");
  finish(true);
  await new Promise((resolve) => setTimeout(resolve, 60));
  expect(t.frames.filter((frame) => (frame as { id?: string }).id === id)).toHaveLength(0);
});
it("does not confirm a model change when the native result differs", async () => {
  const t = await setup();
  t.pi.setModel.mockImplementationOnce(async () => {
    Object.assign(t.ctx, { model: { id: "other", provider: "provider" } });
    return true;
  });
  expect(await t.ack(modelCommand(t, "set-model"))).toMatchObject({
    outcome: "rejected",
    reason: expect.stringContaining("uncertain"),
  });
});
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

it("restores a root prompt through real Pi even when a tree hook appends extension state", async () => {
  const t = await setup();
  t.emit("session_shutdown");
  vi.stubEnv("PI_OFFLINE", "1");
  const extraExtension = process.env.PI_TREE_TEST_EXTENSION;
  if (extraExtension) vi.stubEnv("HOME", t.dir);
  const stateType = extraExtension ? "plannotator" : "tree-fixture-state";
  const { createAgentSession, DefaultResourceLoader, SessionManager, SettingsManager } =
    (await import(
      process.env.PI_TREE_TEST_MODULE ?? "@earendil-works/pi-coding-agent"
    )) as typeof import("@earendil-works/pi-coding-agent");
  const manager = SessionManager.create(t.dir, join(t.dir, "sessions"));
  const rootPrompt = "original root prompt ".repeat(100);
  const root = manager.appendMessage({
    role: "user",
    content: rootPrompt,
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
    additionalExtensionPaths: extraExtension ? [extraExtension] : [],
    extensionFactories: [
      liveChat,
      (pi) => {
        // Plannotator and other extensions persist non-message state after
        // navigation. This legitimately advances the leaf before Pi returns.
        if (!extraExtension)
          pi.on("session_tree", () => pi.appendEntry(stateType, { phase: "idle" }));
      },
    ],
  });
  await resourceLoader.reload();
  expect(resourceLoader.getExtensions().errors).toEqual([]);
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
    const pageId = randomUUID();
    writeFrame(t.connections.at(-1)!, {
      type: "command",
      id: pageId,
      target: targetOf(t.latest()!),
      action: "tree-page",
      page: { query: "original root" },
    });
    const page = treePageResponseSchema.parse(await t.ack(pageId)).page;
    expect(page.rows[0]).toMatchObject({ id: root, textTruncated: true });
    expect(page.rows[0].text.length).toBe(240);
    const id = randomUUID();
    writeFrame(t.connections.at(-1)!, {
      type: "command",
      id,
      target: targetOf(t.latest()!),
      action: "navigate",
      entryId: page.rows[0].id,
    });
    const result = await t.ack(id);
    expect(result, JSON.stringify(result)).toMatchObject({
      type: "navigated",
      prompt: { text: rootPrompt, attachments: [] },
    });
    expect(manager.getBranch()).toEqual([
      expect.objectContaining({ type: "custom", customType: stateType, parentId: null }),
    ]);
    for (const preserved of [root, active, alternate])
      expect(manager.getEntry(preserved)).toBeDefined();
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

it("uses real Pi shutdown bindings without submitting or changing a terminal draft", async () => {
  const t = await setup();
  t.emit("session_shutdown");
  vi.stubEnv("PI_OFFLINE", "1");
  const { createAgentSession, DefaultResourceLoader, SessionManager, SettingsManager } =
    (await import(
      process.env.PI_TREE_TEST_MODULE ?? "@earendil-works/pi-coding-agent"
    )) as typeof import("@earendil-works/pi-coding-agent");
  const { Editor } = (await import(
    process.env.PI_EDITOR_TEST_MODULE ?? "@earendil-works/pi-tui"
  )) as typeof import("@earendil-works/pi-tui");
  const identity = (text: string) => text;
  const editor = new Editor(
    {
      requestRender() {},
      terminal: { rows: 24, columns: 80 },
    } as unknown as import("@earendil-works/pi-tui").TUI,
    {
      borderColor: identity,
      selectList: {
        selectedPrefix: identity,
        selectedText: identity,
        description: identity,
        scrollInfo: identity,
        noMatch: identity,
      },
    },
  );
  editor.setText("An older unsent prompt");
  const submitted = vi.fn();
  editor.onSubmit = submitted;
  const manager = SessionManager.create(t.dir, join(t.dir, "sessions"));
  manager.appendMessage({ role: "user", content: "saved conversation", timestamp: 1 });
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
  expect(resourceLoader.getExtensions().errors).toEqual([]);
  const { session } = await createAgentSession({
    cwd: t.dir,
    agentDir,
    settingsManager,
    resourceLoader,
    sessionManager: manager,
    tools: [],
  });
  const prompt = vi.spyOn(session.agent, "prompt");
  const stream = vi.fn(() => {
    throw new Error("Model must never be called");
  });
  session.agent.streamFunction = stream;
  const shutdown = vi.fn();
  const errors: unknown[] = [];
  try {
    await session.bindExtensions({
      mode: "tui",
      shutdownHandler: shutdown,
      uiContext: {
        ...t.ctx.ui,
        getEditorText: () => editor.getExpandedText(),
        setEditorText: (text) => editor.setText(text),
      },
      onError: (error) => errors.push(error),
    });
    await vi.waitFor(() => expect(t.latest()?.identity.sessionId).toBe(manager.getSessionId()));
    const entries = manager.getEntries();
    expect(await t.ack(t.command("shutdown"))).toMatchObject({
      outcome: "rejected",
      reason: expect.stringContaining("unsent draft"),
    });
    expect(editor.getText()).toBe("An older unsent prompt");
    expect(shutdown).not.toHaveBeenCalled();
    // Simulate the user saving/clearing their editor, never the restart code.
    editor.setText("");
    expect(await t.ack(t.command("shutdown"))).toMatchObject({ type: "shutdown-requested" });
    expect(shutdown).toHaveBeenCalledOnce();
    expect(prompt).not.toHaveBeenCalled();
    expect(stream).not.toHaveBeenCalled();
    expect(submitted).not.toHaveBeenCalled();
    expect(manager.getEntries()).toEqual(entries);
    expect(errors).toEqual([]);
  } finally {
    await session.extensionRunner?.emit({ type: "session_shutdown", reason: "quit" });
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

it("sends ten 10 MiB image-only uploads as Pi ImageContent without putting base64 on the socket", async () => {
  const t = await setup();
  vi.stubEnv("FERNBLICK_UPLOAD_DIR", t.dir);
  const attachments = Array.from({ length: 10 }, () => `${randomUUID()}.png`);
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
  expect(content.filter((b) => b.type === "image")).toHaveLength(10);
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
}, 15_000);

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
  // This persistence happens AFTER message_end, as in Pi.
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
it("coalesces large transcript updates through a brief socket stall without reconnecting", async () => {
  const t = await setup(({ branch }) => {
    for (let i = 0; i < 80; i++) {
      branch.push({
        type: "message",
        id: `history-${i}`,
        message: { role: "user", timestamp: i, content: "x".repeat(24_000) },
      });
    }
  });
  const initial = t.latest()!;
  expect(Buffer.byteLength(JSON.stringify(initial))).toBeGreaterThan(1_900_000);
  const reader = t.connections[0];
  reader.pause();
  try {
    for (let i = 0; i < 6; i++) {
      t.emit("message_update", {
        message: { role: "assistant", timestamp: 999, content: `streaming-${i}` },
      });
      await new Promise((done) => setTimeout(done, 100));
    }
    expect(t.connections).toHaveLength(1);
    reader.resume();
    await vi.waitFor(() => expect(t.latest()?.messages.at(-1)?.text).toBe("streaming-5"));
    expect(t.latest()?.epoch).toBe(initial.epoch);
    expect(
      t.frames.some(
        (frame) =>
          snapshotSchema.safeParse(frame).success &&
          /streaming-[1-4]/.test((frame as Snapshot).messages.at(-1)?.text ?? ""),
      ),
    ).toBe(false);
    const received = t.frames.length;
    await new Promise((done) => setTimeout(done, 150));
    expect(t.frames).toHaveLength(received);
  } finally {
    reader.resume();
  }
});

it("disconnects a permanently stalled snapshot reader after a fixed deadline", async () => {
  const t = await setup(({ branch }) => {
    for (let i = 0; i < 80; i++) {
      branch.push({
        type: "message",
        id: `history-${i}`,
        message: { role: "user", timestamp: i, content: "x".repeat(24_000) },
      });
    }
  });
  const reader = t.connections[0];
  reader.pause();
  vi.useFakeTimers();
  try {
    t.emit("agent_start");
    await vi.advanceTimersByTimeAsync(50);
    await vi.advanceTimersByTimeAsync(30_000);
    // A newer update does not extend the original stall deadline.
    t.emit("message_update", {
      message: { role: "assistant", timestamp: 999, content: "still streaming" },
    });
    await vi.advanceTimersByTimeAsync(29_999);
    expect(t.connections).toHaveLength(1);
    expect(t.latest()?.busy).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    reader.resume();
    await vi.waitFor(() => expect(reader.destroyed).toBe(true));
    await vi.waitFor(() => expect(t.connections).toHaveLength(2));
    await vi.waitFor(() => expect(t.latest()?.messages.at(-1)?.text).toBe("still streaming"));
    expect(t.latest()?.busy).toBe(true);
  } finally {
    reader.resume();
  }
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

it.each(["interactive", "extension"])(
  "exposes whiteboard from the first %s turn without a UI-specific prompt or image",
  async (source) => {
    const t = await setup();
    expect(t.tools.get("board_read")?.exposure).toBe("hidden");
    t.emit("input", { text: "An ordinary message", source });
    const before = Promise.all(
      t.emit("before_agent_start", {
        prompt: "An expanded ordinary message",
        systemPrompt: "Base",
      }),
    );
    const controls = () =>
      t.frames.filter(
        (frame) =>
          !!frame && typeof frame === "object" && "type" in frame && frame.type === "board-control",
      ) as { id: string; action: string; runId: string }[];
    await vi.waitFor(() => expect(controls().at(-1)?.action).toBe("begin"));
    writeFrame(t.connections.at(-1)!, {
      type: "board-reply",
      id: controls().at(-1)!.id,
      ok: true,
      data: { expiresAt: Date.now() + 60_000 },
    });
    await before;
    expect(t.pi.getActiveTools()).toEqual(["read", "bash", "board_read", "board_apply"]);
    expect(boardRequests(t)).toEqual([]);
    expect(t.pi.sendUserMessage).not.toHaveBeenCalled();
    t.emit("agent_start");
    const reading = t.tools
      .get("board_read")!
      .execute("read", {}, undefined, undefined, t.ctx as ExtensionToolContext);
    await vi.waitFor(() => expect(controls().at(-1)?.action).toBe("grant"));
    const grant = { boardId: "a".repeat(64), grantId: randomUUID(), mode: "edit", revision: 0 };
    writeFrame(t.connections.at(-1)!, {
      type: "board-reply",
      id: controls().at(-1)!.id,
      ok: true,
      data: { grant },
    });
    await vi.waitFor(() => expect(boardRequests(t).at(-1)?.action).toBe("read"));
    const data = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString("base64");
    writeFrame(t.connections.at(-1)!, {
      type: "board-reply",
      id: boardRequests(t).at(-1)!.id,
      ok: true,
      data: { revision: 0, elements: [], image: { mimeType: "image/png", data } },
    });
    expect(await reading).toMatchObject({
      content: [{ type: "text" }, { type: "image", mimeType: "image/png", data }],
    });
  },
);

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
  expect(t.latest()?.capabilities).toEqual({
    boards: true,
    skills: true,
    compact: true,
    models: true,
    thinking: true,
    defaults: true,
    treePages: true,
    shutdown: true,
  });
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
