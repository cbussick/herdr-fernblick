import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { connect, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LiveBridge } from "./liveBridge.js";
import { createHttpServer } from "../http/server.js";
import type { HerdrService } from "../herdr/herdrService.js";
import type { Agent } from "../../src/shared/api/contracts.js";
import { type Snapshot, targetOf } from "../../packages/pi-live-chat/protocol.js";
import { receiveFrames, writeFrame } from "../../packages/pi-live-chat/transport.js";

const agent: Agent = {
  agent: "pi",
  pane_id: "w1:p1",
  agent_status: "idle",
  focused: false,
  revision: 1,
  workspace_id: "w1",
  tab_id: "w1:t1",
  agent_session: { agent: "pi", kind: "path", source: "pi", value: "/session.jsonl" },
};
const makeSnapshot = (): Snapshot => ({
  type: "snapshot",
  version: 1,
  epoch: randomUUID(),
  seq: 1,
  identity: {
    runtime: randomUUID(),
    pid: 123,
    processStart: "456",
    pane: agent.pane_id,
    herdrSocket: "/herdr.sock",
    sessionId: "session",
    sessionFile: "/session.jsonl",
  },
  busy: false,
  sendPending: false,
  truncated: false,
  messages: [],
  status: { cwd: "/project", totalTokens: 0, cost: 0 },
});
let dir: string;
let bridge: LiveBridge;
let sockets: Socket[];
const inspect = vi.fn(async () => ({
  start: "456",
  foreground: true,
  alive: true,
  pane: agent.pane_id,
  herdrSocket: "/herdr.sock",
}));
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "fb-test-"));
  sockets = [];
  inspect.mockClear();
  bridge = new LiveBridge(join(dir, "pi.sock"), "/herdr.sock", inspect);
  await bridge.start();
});
afterEach(async () => {
  for (const s of sockets) s.destroy();
  await bridge.close();
  await rm(dir, { recursive: true, force: true });
});
async function peer(snapshot = makeSnapshot()) {
  const socket = connect(bridge.path);
  sockets.push(socket);
  await new Promise<void>((done) => socket.once("connect", done));
  writeFrame(socket, snapshot);
  await vi.waitFor(() =>
    expect(bridge.current(agent).snapshot.identity.runtime).toBe(snapshot.identity.runtime),
  );
  return { socket, snapshot };
}
it("fails closed for absent, stale, ambiguous and background mappings", async () => {
  await expect(bridge.resolve(agent)).rejects.toThrow("unavailable");
  const p = await peer();
  await expect(
    bridge.resolve({ ...agent, agent_session: { ...agent.agent_session!, value: "/other" } }),
  ).rejects.toThrow("do not match");
  inspect.mockResolvedValueOnce({
    start: "999",
    foreground: true,
    alive: true,
    pane: agent.pane_id,
    herdrSocket: "/herdr.sock",
  });
  await expect(bridge.resolve(agent)).rejects.toThrow("stale");
  inspect.mockResolvedValueOnce({
    start: "456",
    foreground: false,
    alive: true,
    pane: agent.pane_id,
    herdrSocket: "/herdr.sock",
  });
  await expect(bridge.resolve(agent)).rejects.toThrow("foreground");
  const second = connect(bridge.path);
  sockets.push(second);
  await new Promise<void>((done) => second.once("connect", done));
  writeFrame(second, {
    ...p.snapshot,
    identity: { ...p.snapshot.identity, runtime: randomUUID() },
  });
  await vi.waitFor(() => expect(() => bridge.current(agent)).toThrow("Ambiguous"));
});
it("accepts updated snapshots during an awaited process check, but rejects epoch changes", async () => {
  const { socket, snapshot } = await peer();
  let release!: (value: Awaited<ReturnType<typeof inspect>>) => void;
  inspect.mockImplementationOnce(
    () =>
      new Promise((done) => {
        release = done;
      }),
  );
  const resolving = bridge.resolve(agent);
  writeFrame(socket, { ...snapshot, seq: 2 });
  await vi.waitFor(() => expect(bridge.current(agent).snapshot.seq).toBe(2));
  release({
    start: "456",
    foreground: true,
    alive: true,
    pane: agent.pane_id,
    herdrSocket: "/herdr.sock",
  });
  expect((await resolving).snapshot.seq).toBe(2);
  inspect.mockImplementationOnce(
    () =>
      new Promise((done) => {
        release = done;
      }),
  );
  const changed = bridge.resolve(agent);
  const epoch = randomUUID();
  writeFrame(socket, { ...snapshot, epoch, seq: 1 });
  await vi.waitFor(() => expect(bridge.current(agent).snapshot.epoch).toBe(epoch));
  release({
    start: "456",
    foreground: true,
    alive: true,
    pane: agent.pane_id,
    herdrSocket: "/herdr.sock",
  });
  await expect(changed).rejects.toThrow("stale");
});
it("rejects busy, concurrent and stale commands; ACK means invoked; disconnect never retries", async () => {
  const { socket, snapshot } = await peer();
  await expect(
    bridge.command(agent, { ...targetOf(snapshot), epoch: randomUUID() }, "send", "hi"),
  ).rejects.toThrow("changed");
  writeFrame(socket, { ...snapshot, seq: 2, busy: true });
  await vi.waitFor(() => expect(bridge.current(agent).snapshot.busy).toBe(true));
  await expect(bridge.command(agent, targetOf(snapshot), "send", "hi")).rejects.toThrow("busy");
  writeFrame(socket, { ...snapshot, seq: 3 });
  await vi.waitFor(() => expect(bridge.current(agent).snapshot.busy).toBe(false));
  const commands: Record<string, unknown>[] = [];
  receiveFrames(socket, (value) => commands.push(value as Record<string, unknown>));
  const pending = bridge.command(agent, targetOf(snapshot), "send", "hi");
  await vi.waitFor(() => expect(commands).toHaveLength(1));
  await expect(bridge.command(agent, targetOf(snapshot), "send", "again")).rejects.toThrow(
    "in flight",
  );
  writeFrame(socket, { type: "ack", id: commands[0].id, outcome: "invoked" });
  expect(await pending).toMatchObject({ type: "ack", outcome: "invoked" });
  const uncertain = bridge.command(agent, targetOf(snapshot), "stop");
  const rejection = expect(uncertain).rejects.toThrow("uncertain");
  await vi.waitFor(() => expect(commands).toHaveLength(2));
  socket.destroy();
  await rejection;
  const replacement = await peer({ ...snapshot, epoch: randomUUID() });
  const retried = vi.fn();
  receiveFrames(replacement.socket, retried);
  await new Promise((done) => setTimeout(done, 30));
  expect(retried).not.toHaveBeenCalled();
});
it("rejects invalid protocol and out-of-order sequences", async () => {
  const { socket, snapshot } = await peer();
  writeFrame(socket, { ...snapshot, seq: 1 });
  await vi.waitFor(() => expect(socket.destroyed).toBe(true));
  await expect(bridge.resolve(agent)).rejects.toThrow("unavailable");
});
it("carries the browser request ID through HTTP and requires the current send bridge", async () => {
  const p = await peer();
  const service = { getAgent: vi.fn(async () => agent) } as unknown as HerdrService;
  const server = createHttpServer(service, dir, bridge);
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const requestId = randomUUID();
  const send = () =>
    fetch(base + "/api/agents/w1:p1/prompt", {
      method: "POST",
      headers: { Origin: base, "Content-Type": "application/json" },
      body: JSON.stringify({ target: targetOf(p.snapshot), text: "hello", requestId }),
    });
  try {
    expect((await send()).status).toBe(409);
    writeFrame(p.socket, { ...p.snapshot, version: 2, seq: 2 });
    await vi.waitFor(() => expect(bridge.current(agent).snapshot.version).toBe(2));
    receiveFrames(p.socket, (command) => {
      expect(command).toMatchObject({ id: requestId, action: "send", text: "hello" });
      writeFrame(p.socket, { type: "ack", id: requestId, outcome: "invoked" });
    });
    const response = await send();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id: requestId, outcome: "invoked" });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
  }
});

it("guards compact HTTP targets and waits for callback confirmation with a longer deadline", async () => {
  const p = await peer();
  const service = { getAgent: vi.fn(async () => agent) } as unknown as HerdrService;
  const server = createHttpServer(service, dir, bridge);
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const commands: { id: string; target: unknown }[] = [];
  receiveFrames(p.socket, (raw) => commands.push(raw as { id: string; target: unknown }));
  const request = (origin = base, target = targetOf(p.snapshot)) =>
    fetch(base + "/api/agents/w1:p1/compact", {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({ target }),
    });
  const timer = vi.spyOn(globalThis, "setTimeout");
  try {
    expect((await request("https://elsewhere.test")).status).toBe(403);
    expect((await request()).status).toBe(409);
    writeFrame(p.socket, { ...p.snapshot, capabilities: { compact: true }, seq: 2, busy: true });
    await vi.waitFor(() => expect(bridge.current(agent).snapshot.busy).toBe(true));
    expect((await request()).status).toBe(409);
    writeFrame(p.socket, { ...p.snapshot, capabilities: { compact: true }, seq: 3 });
    await vi.waitFor(() => expect(bridge.current(agent).snapshot.seq).toBe(3));
    expect((await request(base, { ...targetOf(p.snapshot), epoch: randomUUID() })).status).toBe(
      409,
    );
    expect(commands).toHaveLength(0);
    let settled = false;
    const pending = request().then((r) => {
      settled = true;
      return r;
    });
    await vi.waitFor(() => expect(commands).toHaveLength(1));
    expect(timer.mock.calls.some((c) => c[1] === 120_000)).toBe(true);
    expect(settled).toBe(false);
    expect((await request()).status).toBe(409);
    writeFrame(p.socket, { type: "compacted", id: commands[0].id, target: commands[0].target });
    const response = await pending;
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      type: "compacted",
      target: targetOf(p.snapshot),
    });
    const failure = request();
    await vi.waitFor(() => expect(commands).toHaveLength(2));
    writeFrame(p.socket, {
      type: "ack",
      id: commands[1].id,
      outcome: "rejected",
      reason: "Nothing to compact",
    });
    const failed = await failure;
    expect(failed.status).toBe(409);
    expect(await failed.json()).toEqual({ error: "Nothing to compact" });
  } finally {
    timer.mockRestore();
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
  }
});

it.each(["ack", "wrong-target", "disconnect"])(
  "never confirms or retries compaction on %s",
  async (mode) => {
    const p = await peer({ ...makeSnapshot(), capabilities: { compact: true } });
    const commands: { id: string; target: unknown }[] = [];
    receiveFrames(p.socket, (raw) => commands.push(raw as { id: string; target: unknown }));
    const result = bridge.request(agent, targetOf(p.snapshot), { action: "compact" });
    const rejected = expect(result).rejects.toThrow("uncertain");
    await vi.waitFor(() => expect(commands).toHaveLength(1));
    if (mode === "disconnect") p.socket.destroy();
    else if (mode === "ack")
      writeFrame(p.socket, { type: "ack", id: commands[0].id, outcome: "invoked" });
    else
      writeFrame(p.socket, {
        type: "compacted",
        id: commands[0].id,
        target: { ...targetOf(p.snapshot), epoch: randomUUID() },
      });
    await rejected;
    expect(commands).toHaveLength(1);
  },
);

it("guards the skills HTTP route and refuses skill sends to legacy peers without forwarding", async () => {
  const p = await peer();
  const service = { getAgent: vi.fn(async () => agent) } as unknown as HerdrService;
  const server = createHttpServer(service, dir, bridge);
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const commands: unknown[] = [];
  receiveFrames(p.socket, (raw) => {
    commands.push(raw);
    const c = raw as { id: string; target: unknown };
    writeFrame(p.socket, {
      type: "skills",
      id: c.id,
      target: c.target,
      skills: [],
      truncated: false,
    });
  });
  const request = (origin = base, target = targetOf(p.snapshot)) =>
    fetch(base + "/api/agents/w1:p1/skills", {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({ target }),
    });
  try {
    expect((await request("https://elsewhere.test")).status).toBe(403);
    expect((await request()).status).toBe(409);
    await expect(
      bridge.command(agent, targetOf(p.snapshot), "send", "/skill:review"),
    ).rejects.toThrow("/reload");
    expect(commands).toHaveLength(0);
    writeFrame(p.socket, {
      ...p.snapshot,
      version: 2,
      capabilities: { skills: true },
      seq: 2,
      busy: true,
    });
    await vi.waitFor(() => expect(bridge.current(agent).snapshot.capabilities?.skills).toBe(true));
    expect((await request(base, { ...targetOf(p.snapshot), epoch: randomUUID() })).status).toBe(
      409,
    );
    const result = await request();
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({
      type: "skills",
      skills: [],
      target: targetOf(p.snapshot),
    });
    expect(commands).toHaveLength(1);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
  }
});

it("rejects skills responses from a different epoch", async () => {
  const p = await peer({ ...makeSnapshot(), version: 2, capabilities: { skills: true } });
  receiveFrames(p.socket, (raw) => {
    const c = raw as { id: string; target: object };
    writeFrame(p.socket, {
      type: "skills",
      id: c.id,
      target: { ...c.target, epoch: randomUUID() },
      skills: [],
      truncated: false,
    });
  });
  await expect(bridge.request(agent, targetOf(p.snapshot), { action: "skills" })).rejects.toThrow(
    "uncertain",
  );
});

it("reports a new agent without a saved session as connecting, not an error", async () => {
  const service = {
    getAgent: vi.fn(async () => ({ ...agent, agent_session: null })),
  } as unknown as HerdrService;
  const server = createHttpServer(service, dir, bridge);
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const abort = new AbortController();
  try {
    const response = await fetch(
      `http://127.0.0.1:${(server.address() as { port: number }).port}/api/agents/w1:p1/chat`,
      { signal: abort.signal },
    );
    const frame = new TextDecoder().decode((await response.body!.getReader().read()).value);
    expect(frame).toContain('"type":"connecting"');
    expect(frame).not.toContain('"type":"unavailable"');
  } finally {
    abort.abort();
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
  }
});

it("SSE streams directly after one Herdr lookup, reconnects fresh and removes queue routes", async () => {
  const p = await peer();
  const getAgent = vi.fn(async () => agent);
  const service = { getAgent } as unknown as HerdrService;
  const server = createHttpServer(service, dir, bridge);
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address() as { port: number };
  const base = `http://127.0.0.1:${address.port}`;
  const abort = new AbortController();
  try {
    const response = await fetch(base + "/api/agents/w1:p1/chat", { signal: abort.signal });
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    const reader = response.body!.getReader();
    async function nextContaining(value: string) {
      let text = "";
      while (!text.includes(value)) text += new TextDecoder().decode((await reader.read()).value);
      return text;
    }
    expect(await nextContaining('"seq":1')).toContain(p.snapshot.epoch);
    for (let seq = 2; seq <= 5; seq++) {
      writeFrame(p.socket, { ...p.snapshot, seq });
      await nextContaining(`"seq":${seq}`);
    }
    expect(getAgent).toHaveBeenCalledTimes(1);
    expect(inspect).toHaveBeenCalledTimes(1);
    // Changed extension session is unavailable, never silently remapped.
    p.socket.destroy();
    await nextContaining('"type":"unavailable"');
    const fresh = await peer({ ...p.snapshot, epoch: randomUUID(), seq: 1 });
    expect(await nextContaining(fresh.snapshot.epoch)).toContain('"seq":1');
    expect(getAgent).toHaveBeenCalledTimes(1);
    // A fresh browser connection ignores Last-Event-ID and starts with a snapshot.
    const reconnect = await fetch(base + "/api/agents/w1:p1/chat", {
      headers: { "Last-Event-ID": `${p.snapshot.epoch}:99` },
      signal: abort.signal,
    });
    expect(new TextDecoder().decode((await reconnect.body!.getReader().read()).value)).toContain(
      fresh.snapshot.epoch,
    );
    expect((await fetch(base + "/api/agents/w1:p1/queue")).status).toBe(404);
    expect((await fetch(base + "/api/agents/w1:p1/tree")).status).toBe(404);
    expect(
      (
        await fetch(base + "/api/agents/w1:p1/prompt", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ target: targetOf(fresh.snapshot), text: "hi" }),
        })
      ).status,
    ).toBe(403);
  } finally {
    abort.abort();
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
  }
});
