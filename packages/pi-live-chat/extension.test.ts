import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { afterEach, expect, it, vi } from "vitest";
import liveChat from "./index.js";
import { snapshotSchema, targetOf, type Snapshot } from "./protocol.js";
import { receiveFrames, writeFrame } from "./transport.js";

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
      getSessionId: () => session,
      getSessionFile: () => `/${session}.jsonl`,
    },
  } as unknown as ExtensionContext;
  const pi = {
    on: (event: string, handler: Handler) => {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    },
    sendUserMessage: vi.fn(),
  };
  liveChat(pi as unknown as ExtensionAPI);
  const emit = (event: string, data: Record<string, unknown> = {}) =>
    (handlers.get(event) ?? []).map((handler) => handler({ type: event, ...data }, ctx));
  return {
    pi,
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
  return { ...pi, latest, command, ack, connections, frames, server };
}
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
