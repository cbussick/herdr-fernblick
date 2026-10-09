import { randomUUID } from "node:crypto";
import type { Socket } from "node:net";
import type {
  ExtensionAPI,
  ExtensionToolContext,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BoardTools, type BoardConnection } from "./boardTools.js";
import { type BoardGrant, type BoardRequest, boardRequestSchema } from "./boardProtocol.js";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function setup(mode: BoardGrant["mode"] = "edit") {
  const frames: BoardRequest[] = [];
  const client = {
    destroyed: false,
    connecting: false,
    writable: true,
    writableLength: 0,
    write: vi.fn((frame: string) => {
      frames.push(boardRequestSchema.parse(JSON.parse(frame)));
      return true;
    }),
    destroy: vi.fn(),
  } as unknown as Socket;
  const target = {
    runtime: randomUUID(),
    epoch: randomUUID(),
    sessionId: "session",
  };
  let connection: BoardConnection | undefined = {
    client,
    target,
    sessionFile: "/session.jsonl",
  };
  const grant: BoardGrant = {
    boardId: "a".repeat(64),
    grantId: randomUUID(),
    mode,
    revision: 2,
  };
  const definitions = new Map<string, ToolDefinition>();
  let active = ["read", "bash", "unrelated"];
  const pi = {
    registerTool: vi.fn((definition: ToolDefinition) =>
      definitions.set(definition.name, definition),
    ),
    getActiveTools: () => [...active],
    setActiveTools: vi.fn((names: string[]) => {
      active = names;
    }),
  };
  const ctx = {
    sessionManager: {
      getSessionId: () => "session",
      getSessionFile: () => "/session.jsonl",
    },
  } as unknown as ExtensionToolContext;
  const tools = new BoardTools(pi as unknown as ExtensionAPI, () => connection);
  const stage = (text = "Draw a box") => tools.stage(grant, text, connection!);
  const input = (text = "Draw a box", source = "extension") => tools.input({ text, source });
  const reply = (request = frames.at(-1)!, data: unknown = { revision: 2 }, ok = true) =>
    tools.consume({ type: "board-reply", id: request.id, ok, data }, client);
  const run = (name: string, params: unknown = {}, signal?: AbortSignal) =>
    definitions.get(name)!.execute("call", params, signal, undefined, ctx);
  async function activate() {
    stage();
    input();
    const result = tools.beforeAgentStart("Draw a box", ctx);
    expect(frames.at(-1)?.action).toBe("activate");
    reply();
    await result;
  }
  return {
    tools,
    pi,
    definitions,
    frames,
    client,
    target,
    grant,
    ctx,
    stage,
    input,
    reply,
    run,
    activate,
    connection: () => connection,
    changeConnection: (value: BoardConnection | undefined) => {
      connection = value;
    },
  };
}
const apply = () => ({
  baseRevision: 2,
  operationId: randomUUID(),
  operations: [
    {
      op: "create",
      id: "box",
      kind: "rectangle",
      x: 0,
      y: 0,
      width: 40,
      height: 30,
    },
  ],
});

it("registers hidden/default-inactive tools and prompt text alone cannot grant access", async () => {
  const t = setup();
  expect(t.pi.registerTool).toHaveBeenCalledTimes(2);
  for (const tool of t.definitions.values()) {
    expect(tool).toMatchObject({ exposure: "hidden", defaultActive: false });
    expect(JSON.stringify(tool)).not.toContain(t.grant.grantId);
  }
  expect(t.pi.getActiveTools()).toEqual(["read", "bash", "unrelated"]);
  t.input();
  expect(await t.tools.beforeAgentStart("Draw a box", t.ctx)).toBeUndefined();
  await expect(t.run("board_read")).rejects.toThrow("No active");
  await expect(t.run("board_apply", apply())).rejects.toThrow("No active");
  expect(t.frames).toEqual([]);
});

it.each([
  ["Draw a box", "interactive", "Draw a box"],
  ["Draw a box", "rpc", "Draw a box"],
  ["Other input", "extension", "Draw a box"],
  ["Draw a box", "extension", "Transformed prompt"],
])("rejects mismatched input/prompt (%s, %s, %s) permanently", async (text, source, prompt) => {
  const t = setup();
  t.stage();
  t.input(text, source);
  await t.tools.beforeAgentStart(prompt, t.ctx);
  t.input();
  await t.tools.beforeAgentStart("Draw a box", t.ctx);
  expect(t.frames.map((r) => r.action)).toEqual(["revoke"]);
  await expect(t.run("board_read")).rejects.toThrow("No active");
});

it("requires input before before_agent_start and expires unconsumed or matched staged grants", async () => {
  const t = setup();
  t.stage();
  expect(await t.tools.beforeAgentStart("Draw a box", t.ctx)).toMatchObject({
    message: { content: expect.stringContaining("did not match") },
  });
  for (const matched of [false, true]) {
    t.stage();
    if (matched) t.input();
    await vi.advanceTimersByTimeAsync(15_000);
    t.input();
    await t.tools.beforeAgentStart("Draw a box", t.ctx);
  }
  expect(t.frames.map((r) => r.action)).toEqual(["revoke", "revoke", "revoke"]);
});

it("awaits activation, preserves unrelated tools, and keeps grant tokens out of definitions and results", async () => {
  const t = setup();
  t.stage();
  t.input();
  const activation = t.tools.beforeAgentStart("Draw a box", t.ctx);
  const request = t.frames[0];
  expect(request).toMatchObject({
    action: "activate",
    target: t.target,
    grantId: t.grant.grantId,
    boardId: t.grant.boardId,
  });
  expect(t.pi.getActiveTools()).not.toContain("board_read");
  await expect(t.run("board_read")).rejects.toThrow("No active");
  t.reply();
  const result = await activation;
  expect(JSON.stringify(result)).not.toContain(t.grant.grantId);
  expect(t.pi.getActiveTools()).toEqual(["read", "bash", "unrelated", "board_read", "board_apply"]);
  for (const tool of t.definitions.values())
    expect(tool).toMatchObject({ defaultActive: false, exposure: "direct" });
  const read = t.run("board_read", { offset: 10, limit: 3 });
  expect(t.frames.at(-1)).toMatchObject({
    action: "read",
    offset: 10,
    limit: 3,
  });
  t.reply(undefined, { revision: 3, text: t.grant.grantId });
  expect(JSON.stringify(await read)).not.toContain(t.grant.grantId);
  t.pi.setActiveTools(["read", "new-tool", "board_read", "board_apply"]);
  t.tools.revoke();
  expect(t.pi.getActiveTools()).toEqual(["read", "new-tool"]);
  for (const tool of t.definitions.values()) expect(tool.exposure).toBe("hidden");
});

it("read-only grants expose only board_read and reject even direct invocation of board_apply", async () => {
  const t = setup("read");
  await t.activate();
  expect(t.pi.getActiveTools()).toContain("board_read");
  expect(t.pi.getActiveTools()).not.toContain("board_apply");
  expect(t.definitions.get("board_apply")?.exposure).toBe("hidden");
  await expect(t.run("board_apply", apply())).rejects.toThrow("read-only");
  const read = t.run("board_read");
  expect(t.frames.at(-1)).toMatchObject({
    action: "read",
    offset: 0,
    limit: 50,
  });
  t.reply(undefined, { revision: 2, elements: [], total: 0 });
  expect(await read).toMatchObject({
    details: undefined,
    content: [{ type: "text" }],
  });
  t.tools.revoke();
});

it("bounds strict tool input and forwards revision/operationId without automatic retries or overwrites", async () => {
  const t = setup();
  await t.activate();
  for (const invalid of [
    { offset: -1 },
    { limit: 101 },
    { offset: 2001 },
    { grantId: t.grant.grantId },
  ]) {
    await expect(t.run("board_read", invalid)).rejects.toThrow("Invalid");
  }
  for (const invalid of [
    { ...apply(), baseRevision: -1 },
    { ...apply(), operationId: "bad" },
    { ...apply(), operations: [] },
    {
      ...apply(),
      operations: Array.from({ length: 51 }, () => apply().operations[0]),
    },
    { ...apply(), operations: [{ op: "delete", id: "bad/id" }] },
    {
      ...apply(),
      operations: [{ op: "update", id: "box", text: "x".repeat(4001) }],
    },
    {
      ...apply(),
      operations: [{ op: "create", id: "box", kind: "image", x: 0, y: 0 }],
    },
  ])
    await expect(t.run("board_apply", invalid)).rejects.toThrow("Invalid");
  expect(t.frames).toHaveLength(1);
  const args = apply();
  const applying = t.run("board_apply", args);
  expect(t.frames.at(-1)).toMatchObject({ action: "apply", ...args });
  t.tools.consume(
    {
      type: "board-reply",
      id: t.frames.at(-1)!.id,
      ok: false,
      error: "Revision conflict: read again",
    },
    t.client,
  );
  await expect(applying).rejects.toThrow("Revision conflict");
  expect(t.frames.map((r) => r.action)).toEqual(["activate", "apply"]);
  t.tools.revoke();
});

it.each(["input", "revoke", "session", "file", "epoch", "runtime", "disconnect", "connection"])(
  "revokes active permission and pending RPCs on %s",
  async (change) => {
    const t = setup();
    await t.activate();
    const retained = t.definitions.get("board_read")!;
    const read = t.run("board_read");
    const rejected = expect(read).rejects.toThrow();
    if (change === "input") t.input("even the next streaming input", "interactive");
    else if (change === "revoke")
      t.tools.consume({ type: "board-revoke", grantId: t.grant.grantId }, t.client);
    else {
      const connection = t.connection()!;
      if (change === "session") connection.target = { ...connection.target, sessionId: "other" };
      if (change === "file") connection.sessionFile = "/other.jsonl";
      if (change === "epoch") connection.target = { ...connection.target, epoch: randomUUID() };
      if (change === "runtime") connection.target = { ...connection.target, runtime: randomUUID() };
      if (change === "disconnect") t.changeConnection(undefined);
      if (change === "connection") connection.client = { ...t.client } as Socket;
      // A late reply rechecks the captured target and connection, not just the ID.
      t.reply();
    }
    await rejected;
    await expect(retained.execute("stale", {}, undefined, undefined, t.ctx)).rejects.toThrow(
      "No active",
    );
    expect(t.definitions.get("board_read")?.exposure).toBe("hidden");
  },
);

it("rejects a changed tool execution context even while the socket binding still looks current", async () => {
  const t = setup();
  await t.activate();
  t.ctx.sessionManager.getSessionId = () => "other-session";
  await expect(t.run("board_read")).rejects.toThrow("stale");
  expect(t.frames.at(-1)?.action).toBe("revoke");
});

it("ignores unknown/stale RPC IDs, stale sockets and unrelated revocations", async () => {
  const t = setup();
  await t.activate();
  const read = t.run("board_read");
  const request = t.frames.at(-1)!;
  let resolved = false;
  void read.then(() => {
    resolved = true;
  });
  expect(t.tools.consume({ type: "command" }, t.client)).toBe(false);
  t.tools.consume({ type: "board-reply", id: randomUUID(), ok: true, data: {} }, t.client);
  t.tools.consume({ type: "board-reply", id: request.id, ok: true, data: {} }, {} as Socket);
  t.tools.consume({ type: "board-revoke", grantId: randomUUID() }, t.client);
  t.reply(t.frames[0]);
  await Promise.resolve();
  expect(resolved).toBe(false);
  t.reply(request, { revision: 8 });
  expect(JSON.stringify(await read)).toContain("8");
  t.reply(request);
  t.tools.revoke();
  expect(new Set(t.frames.map((r) => r.id)).size).toBe(t.frames.length);
});

it.each([
  { type: "board-reply", id: "invalid", ok: true },
  { type: "board-revoke", grantId: "invalid" },
])("fails closed for malformed current board frames: %j", async (frame) => {
  const t = setup();
  await t.activate();
  const read = t.run("board_read");
  const rejected = expect(read).rejects.toThrow("Malformed");
  expect(t.tools.consume(frame, t.client)).toBe(true);
  await rejected;
  expect(t.pi.getActiveTools()).not.toContain("board_read");
});

it("activation failure returns an informational message and cannot grant the next turn", async () => {
  const t = setup();
  t.stage();
  t.input();
  const activation = t.tools.beforeAgentStart("Draw a box", t.ctx);
  t.tools.consume(
    {
      type: "board-reply",
      id: t.frames.at(-1)!.id,
      ok: false,
      error: `Denied ${t.grant.grantId}`,
    },
    t.client,
  );
  const result = await activation;
  expect(result?.message?.content).toContain("unavailable");
  expect(JSON.stringify(result)).not.toContain(t.grant.grantId);
  t.input();
  await t.tools.beforeAgentStart("Draw a box", t.ctx);
  expect(t.frames.map((r) => r.action)).toEqual(["activate", "revoke"]);
});

it("activation timeout revokes the whole grant, ignores late success, and never retries", async () => {
  const t = setup();
  t.stage();
  t.input();
  const activation = t.tools.beforeAgentStart("Draw a box", t.ctx);
  const request = t.frames[0];
  await vi.advanceTimersByTimeAsync(5000);
  expect((await activation)?.message?.content).toContain("timed out");
  t.reply(request);
  expect(t.pi.getActiveTools()).not.toContain("board_read");
  await vi.advanceTimersByTimeAsync(30_000);
  expect(t.frames.map((r) => r.action)).toEqual(["activate", "revoke"]);
});

it("one timed out RPC revokes other in-flight RPCs without retry", async () => {
  const t = setup();
  await t.activate();
  const read = t.run("board_read");
  const applying = t.run("board_apply", apply());
  const rejected = Promise.all([
    expect(read).rejects.toThrow("timed out"),
    expect(applying).rejects.toThrow("timed out"),
  ]);
  await vi.advanceTimersByTimeAsync(5000);
  await rejected;
  expect(t.frames.map((r) => r.action)).toEqual(["activate", "read", "apply", "revoke"]);
});

it.each(["before", "during", "context"])(
  "honors abort %s execution and revokes the grant",
  async (when) => {
    const t = setup();
    await t.activate();
    const controller = new AbortController();
    if (when === "before") controller.abort();
    if (when === "context") Object.assign(t.ctx, { signal: controller.signal });
    const read = t.run("board_read", {}, when === "context" ? undefined : controller.signal);
    const rejected = expect(read).rejects.toThrow(/cancelled|aborted/);
    if (when !== "before") controller.abort();
    await rejected;
    expect(t.frames.at(-1)?.action).toBe("revoke");
    expect(t.pi.getActiveTools()).not.toContain("board_read");
  },
);

it("cannot enable a grant when it is revoked during activation", async () => {
  const t = setup();
  t.stage();
  t.input();
  const activation = t.tools.beforeAgentStart("Draw a box", t.ctx);
  const request = t.frames[0];
  t.input("Draw a box", "interactive");
  t.reply(request);
  expect((await activation)?.message?.content).toContain("unavailable");
  expect(t.pi.getActiveTools()).not.toContain("board_read");
});

it("old cached callables cannot borrow a newer request's authorization", async () => {
  const t = setup();
  await t.activate();
  const retained = t.definitions.get("board_read")!;
  t.tools.revoke();
  t.grant.grantId = randomUUID();
  await t.activate();
  await expect(retained.execute("old-call", {}, undefined, undefined, t.ctx)).rejects.toThrow(
    "No active",
  );
  expect(t.pi.getActiveTools()).toContain("board_read");
  t.tools.revoke();
});

it("expires activated preflight without agent_start, but keeps a started request past the handoff deadline", async () => {
  const t = setup();
  await t.activate();
  await vi.advanceTimersByTimeAsync(15_000);
  expect(t.pi.getActiveTools()).not.toContain("board_read");
  await t.activate();
  t.tools.agentStart(t.ctx);
  await vi.advanceTimersByTimeAsync(15_000);
  expect(t.pi.getActiveTools()).toContain("board_read");
  t.tools.revoke();
});

it("hides tools at the backend lease deadline even if the agent is still working", async () => {
  const t = setup();
  t.stage();
  t.input();
  const activation = t.tools.beforeAgentStart("Draw a box", t.ctx);
  t.reply(undefined, { revision: 2, expiresAt: Date.now() + 30_000 });
  await activation;
  t.tools.agentStart(t.ctx);
  await vi.advanceTimersByTimeAsync(30_000);
  expect(t.definitions.get("board_read")?.exposure).toBe("hidden");
  await expect(t.run("board_read")).rejects.toThrow("No active");
});

it("aborting activation returns a failure notice rather than enabling tools", async () => {
  const t = setup();
  const controller = new AbortController();
  Object.assign(t.ctx, { signal: controller.signal });
  t.stage();
  t.input();
  const activation = t.tools.beforeAgentStart("Draw a box", t.ctx);
  controller.abort();
  expect((await activation)?.message?.content).toContain("aborted");
  expect(t.frames.map((r) => r.action)).toEqual(["activate", "revoke"]);
  expect(t.pi.getActiveTools()).not.toContain("board_read");
});

it("bounds pending requests and cleans all of them on revocation", async () => {
  const t = setup();
  await t.activate();
  const results = Array.from({ length: 8 }, () =>
    expect(t.run("board_read")).rejects.toThrow("ended"),
  );
  await expect(t.run("board_read")).rejects.toThrow("Too many pending");
  expect(t.frames.filter((frame) => frame.action === "read")).toHaveLength(8);
  t.tools.revoke();
  await Promise.all(results);
});

it.each([undefined, { text: "x".repeat(512 * 1024) }])(
  "rejects missing or oversized successful data",
  async (data) => {
    const t = setup();
    await t.activate();
    const read = t.run("board_read");
    t.tools.consume({ type: "board-reply", id: t.frames.at(-1)!.id, ok: true, data }, t.client);
    await expect(read).rejects.toThrow("Invalid or oversized");
    expect(t.pi.getActiveTools()).not.toContain("board_read");
  },
);
