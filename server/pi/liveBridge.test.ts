import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { connect, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LiveBridge } from "./liveBridge.js";
import { createHttpServer } from "../http/server.js";
import { HerdrService } from "../herdr/herdrService.js";
import type { HerdrClient } from "../herdr/HerdrClient.js";
import type { z } from "zod";
import type { Agent } from "../../src/shared/api/contracts.js";
import { type Snapshot, targetOf } from "../../packages/pi-live-chat/protocol.js";
import { receiveFrames, writeFrame } from "../../packages/pi-live-chat/transport.js";
import { readTreePage } from "../../packages/pi-live-chat/treePage.js";

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
it.each(
  ["restart", "exit"].flatMap((action) =>
    [
      "old-peer",
      "busy",
      "send-pending",
      "draft",
      "lost",
      "wrong-target",
      "wrong-type",
      "success",
    ].map((condition) => ({ action, condition })),
  ),
)(
  "guards $action through HTTP without terminal input: $condition",
  async ({ action, condition }) => {
    const snapshot = makeSnapshot();
    if (condition !== "old-peer") snapshot.capabilities = { shutdown: true };
    snapshot.busy = condition === "busy";
    snapshot.sendPending = condition === "send-pending";
    const p = await peer(snapshot);
    const commands: unknown[] = [];
    receiveFrames(p.socket, (raw) => {
      const command = raw as { id: string; action: string; target: unknown };
      commands.push(command);
      if (condition === "lost") {
        p.socket.destroy();
        return;
      }
      if (condition === "draft") {
        writeFrame(p.socket, {
          type: "ack",
          id: command.id,
          outcome: "rejected",
          reason: "Pi terminal has an unsent draft",
        });
        return;
      }
      if (condition === "wrong-type") {
        writeFrame(p.socket, { type: "ack", id: command.id, outcome: "invoked" });
        return;
      }
      writeFrame(p.socket, {
        type: "shutdown-requested",
        id: command.id,
        target:
          condition === "wrong-target"
            ? { ...targetOf(snapshot), epoch: randomUUID() }
            : command.target,
      });
    });
    const request = vi.fn(async <T>(method: string, _params: unknown, schema: z.ZodType<T>) => {
      if (method === "agent.get") return schema.parse({ type: "agent_info", agent });
      if (method === "session.snapshot")
        return schema.parse({
          type: "session_snapshot",
          snapshot: { agents: [], panes: [], tabs: [], workspaces: [] },
        });
      if (method === "agent.start") return schema.parse({ type: "agent_started", agent });
      throw new Error(`Unexpected Herdr call: ${method}`);
    });
    const service = new HerdrService({ request } as unknown as HerdrClient);
    const server = createHttpServer(service, dir, bridge);
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const restart = (origin = base) =>
      fetch(base + `/api/agents/w1:p1/${action}`, { method: "POST", headers: { Origin: origin } });
    try {
      expect((await restart("https://elsewhere.test")).status).toBe(403);
      expect(request).not.toHaveBeenCalled();
      const response = await restart();
      const body = await response.json();
      if (condition === "success") {
        expect(response.status).toBe(200);
        if (action === "restart") {
          expect(body.agent.agent_session.value).toBe(agent.agent_session!.value);
          expect(
            request.mock.calls.find(([method]) => method === "agent.start")?.[1],
          ).toMatchObject({
            pane_id: agent.pane_id,
            args: expect.arrayContaining(["--session", agent.agent_session!.value]),
          });
        } else {
          expect(body).toEqual({ ok: true });
          expect(request.mock.calls.map(([method]) => method)).toEqual([
            "agent.get",
            "session.snapshot",
          ]);
        }
      } else {
        expect(response.status).toBe(409);
        expect(request.mock.calls.map(([method]) => method)).toEqual(["agent.get"]);
        if (condition === "old-peer") expect(body.error).toContain("/reload");
        if (condition === "draft") expect(body.error).toContain("unsent draft");
      }
      expect(commands).toHaveLength(
        ["old-peer", "busy", "send-pending"].includes(condition) ? 0 : 1,
      );
      for (const command of commands)
        expect(command).toMatchObject({ action: "shutdown", target: targetOf(snapshot) });
      expect(request.mock.calls.some(([method]) => method === "pane.send_input")).toBe(false);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((done) => server.close(() => done()));
    }
  },
);

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

it("pages trees over HTTP, rejects unsafe/stale requests and explains older peers", async () => {
  const p = await peer();
  const service = { getAgent: vi.fn(async () => agent) } as unknown as HerdrService;
  const server = createHttpServer(service, dir, bridge);
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const commands: unknown[] = [];
  const page = readTreePage({ getEntries: () => [], getLeafId: () => null }, {});
  receiveFrames(p.socket, (raw) => {
    const command = raw as { id: string; target: unknown };
    commands.push(raw);
    writeFrame(p.socket, { type: "tree-page", id: command.id, target: command.target, page });
  });
  const request = (body: unknown = {}, origin = base, target = targetOf(p.snapshot)) =>
    fetch(base + "/api/agents/w1:p1/tree-page", {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({ target, page: body }),
    });
  try {
    expect((await request({}, "https://elsewhere.test")).status).toBe(403);
    const old = await request();
    expect(old.status).toBe(409);
    expect(await old.text()).toContain("/reload");
    writeFrame(p.socket, { ...p.snapshot, seq: 2, capabilities: { treePages: true } });
    await vi.waitFor(() => expect(bridge.current(agent).snapshot.seq).toBe(2));
    expect((await request({ offset: 10 })).status).toBe(400);
    expect((await request({ query: "x".repeat(257) })).status).toBe(400);
    expect((await request({}, base, { ...targetOf(p.snapshot), epoch: randomUUID() })).status).toBe(
      409,
    );
    expect(commands).toHaveLength(0);
    const response = await request({ query: "Needle", filter: "user" });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ type: "tree-page", page });
    expect(commands).toEqual([
      expect.objectContaining({ action: "tree-page", page: { query: "Needle", filter: "user" } }),
    ]);
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

it("guards model HTTP routes by origin, capability, identity, input and idle state", async () => {
  const p = await peer();
  const service = { getAgent: vi.fn(async () => agent) } as unknown as HerdrService;
  const server = createHttpServer(service, dir, bridge);
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const commands: unknown[] = [];
  receiveFrames(p.socket, (raw) => {
    commands.push(raw);
    const c = raw as {
      id: string;
      action: string;
      target: unknown;
      provider: string;
      modelId: string;
    };
    writeFrame(
      p.socket,
      c.action === "models"
        ? {
            type: "models",
            id: c.id,
            target: c.target,
            models: [],
            truncated: false,
          }
        : {
            type: "model-changed",
            id: c.id,
            target: c.target,
            model: { provider: c.provider, id: c.modelId, name: "Test model" },
          },
    );
  });
  const request = (action: string, body: object = {}, origin = base) =>
    fetch(base + "/api/agents/w1:p1/" + action, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({ target: targetOf(p.snapshot), ...body }),
    });
  try {
    expect((await request("models", {}, "https://elsewhere.test")).status).toBe(403);
    expect((await request("models")).status).toBe(409);
    const selection = { provider: "provider", modelId: "model" };
    expect((await request("set-model", selection)).status).toBe(409);
    writeFrame(p.socket, { ...p.snapshot, seq: 2, busy: true, capabilities: { models: true } });
    await vi.waitFor(() => expect(bridge.current(agent).snapshot.seq).toBe(2));
    expect((await request("set-model", selection)).status).toBe(409);
    expect((await request("models")).status).toBe(200);
    expect((await request("set-model", { provider: "provider" })).status).toBe(400);
    writeFrame(p.socket, { ...p.snapshot, seq: 3, capabilities: { models: true } });
    await vi.waitFor(() => expect(bridge.current(agent).snapshot.seq).toBe(3));
    expect(
      (
        await request("set-model", {
          ...selection,
          target: { ...targetOf(p.snapshot), epoch: randomUUID() },
        })
      ).status,
    ).toBe(409);
    const result = await request("set-model", selection);
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({
      type: "model-changed",
      model: { provider: "provider", id: "model" },
    });
    expect(commands).toHaveLength(2);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
  }
});
it.each(["wrong-target", "wrong-model", "ack"])("rejects %s model confirmations", async (kind) => {
  const p = await peer({ ...makeSnapshot(), capabilities: { models: true } });
  receiveFrames(p.socket, (raw) => {
    const c = raw as { id: string; target: object };
    writeFrame(
      p.socket,
      kind === "ack"
        ? { type: "ack", id: c.id, outcome: "invoked" }
        : {
            type: "model-changed",
            id: c.id,
            target: kind === "wrong-target" ? { ...c.target, epoch: randomUUID() } : c.target,
            model: {
              id: kind === "wrong-model" ? "other" : "model",
              provider: "provider",
              name: "Test",
            },
          },
    );
  });
  await expect(
    bridge.request(agent, targetOf(p.snapshot), {
      action: "set-model",
      provider: "provider",
      modelId: "model",
    }),
  ).rejects.toThrow("uncertain");
});
it("guards thinking HTTP routes with origin, capability, idle state, model and typed levels", async () => {
  const p = await peer();
  const service = { getAgent: vi.fn(async () => agent) } as unknown as HerdrService;
  const server = createHttpServer(service, dir, bridge);
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const commands: unknown[] = [];
  receiveFrames(p.socket, (raw) => {
    commands.push(raw);
    const c = raw as {
      id: string;
      action: string;
      target: unknown;
      provider: string;
      modelId: string;
      level: string;
    };
    writeFrame(
      p.socket,
      c.action === "thinking-levels"
        ? {
            type: "thinking-levels",
            id: c.id,
            target: c.target,
            provider: "provider",
            modelId: "model",
            level: "medium",
            levels: ["off", "low", "medium", "high"],
          }
        : {
            type: "thinking-level-changed",
            id: c.id,
            target: c.target,
            provider: c.provider,
            modelId: c.modelId,
            level: c.level,
          },
    );
  });
  const request = (action: string, body: object = {}, origin = base) =>
    fetch(base + "/api/agents/w1:p1/" + action, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({ target: targetOf(p.snapshot), ...body }),
    });
  try {
    expect((await request("thinking-levels", {}, "https://elsewhere.test")).status).toBe(403);
    expect((await request("thinking-levels")).status).toBe(409);
    const selection = { provider: "provider", modelId: "model", level: "high" };
    expect((await request("set-thinking-level", selection)).status).toBe(409);
    writeFrame(p.socket, { ...p.snapshot, seq: 2, busy: true, capabilities: { thinking: true } });
    await vi.waitFor(() => expect(bridge.current(agent).snapshot.seq).toBe(2));
    expect((await request("set-thinking-level", selection)).status).toBe(409);
    expect((await request("thinking-levels")).status).toBe(200);
    expect((await request("set-thinking-level", { ...selection, level: "turbo" })).status).toBe(
      400,
    );
    expect((await request("set-thinking-level", { level: "high" })).status).toBe(400);
    writeFrame(p.socket, { ...p.snapshot, seq: 3, capabilities: { thinking: true } });
    await vi.waitFor(() => expect(bridge.current(agent).snapshot.seq).toBe(3));
    expect(
      (
        await request("set-thinking-level", {
          ...selection,
          target: { ...targetOf(p.snapshot), epoch: randomUUID() },
        })
      ).status,
    ).toBe(409);
    const result = await request("set-thinking-level", selection);
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ type: "thinking-level-changed", ...selection });
    expect(commands).toHaveLength(2);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
  }
});
it.each(["wrong-target", "wrong-model", "wrong-level", "ack"])(
  "rejects %s thinking confirmations",
  async (kind) => {
    const p = await peer({ ...makeSnapshot(), capabilities: { thinking: true } });
    receiveFrames(p.socket, (raw) => {
      const c = raw as { id: string; target: object };
      writeFrame(
        p.socket,
        kind === "ack"
          ? { type: "ack", id: c.id, outcome: "invoked" }
          : {
              type: "thinking-level-changed",
              id: c.id,
              target: kind === "wrong-target" ? { ...c.target, epoch: randomUUID() } : c.target,
              modelId: kind === "wrong-model" ? "other" : "model",
              provider: "provider",
              level: kind === "wrong-level" ? "low" : "high",
            },
      );
    });
    await expect(
      bridge.request(agent, targetOf(p.snapshot), {
        action: "set-thinking-level",
        provider: "provider",
        modelId: "model",
        level: "high",
      }),
    ).rejects.toThrow("uncertain");
  },
);
it("guards global default writes with Origin, capability, identity, idle state and validated selections", async () => {
  const p = await peer();
  const service = { getAgent: vi.fn(async () => agent) } as unknown as HerdrService;
  const server = createHttpServer(service, dir, bridge);
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const commands: unknown[] = [];
  receiveFrames(p.socket, (raw) => {
    commands.push(raw);
    const c = raw as { id: string; target: unknown; selection: unknown };
    writeFrame(p.socket, {
      type: "default-saved",
      id: c.id,
      target: c.target,
      selection: c.selection,
    });
  });
  const model = { kind: "model", provider: "provider", modelId: "model" };
  const request = (selection: object = model, origin = base, target = targetOf(p.snapshot)) =>
    fetch(base + "/api/agents/w1:p1/save-default", {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({ target, selection }),
    });
  try {
    expect((await request(model, "https://elsewhere.test")).status).toBe(403);
    expect((await request()).status).toBe(409);
    writeFrame(p.socket, { ...p.snapshot, seq: 2, busy: true, capabilities: { defaults: true } });
    await vi.waitFor(() => expect(bridge.current(agent).snapshot.seq).toBe(2));
    expect((await request()).status).toBe(409);
    writeFrame(p.socket, { ...p.snapshot, seq: 3, capabilities: { defaults: true } });
    await vi.waitFor(() => expect(bridge.current(agent).snapshot.seq).toBe(3));
    expect((await request({ ...model, kind: "thinking", level: "turbo" })).status).toBe(400);
    expect((await request({ kind: "model" })).status).toBe(400);
    expect(
      (await request(model, base, { ...targetOf(p.snapshot), epoch: randomUUID() })).status,
    ).toBe(409);
    for (const selection of [model, { ...model, kind: "thinking", level: "high" }]) {
      const response = await request(selection);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ type: "default-saved", selection });
    }
    expect(commands).toHaveLength(2);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
  }
});
it.each(["wrong-target", "wrong-model", "wrong-kind", "wrong-level", "ack"])(
  "rejects %s default-save confirmations",
  async (kind) => {
    const p = await peer({ ...makeSnapshot(), capabilities: { defaults: true } });
    const selection = {
      kind: "thinking",
      provider: "provider",
      modelId: "model",
      level: "high",
    } as const;
    receiveFrames(p.socket, (raw) => {
      const c = raw as { id: string; target: object };
      writeFrame(
        p.socket,
        kind === "ack"
          ? { type: "ack", id: c.id, outcome: "invoked" }
          : {
              type: "default-saved",
              id: c.id,
              target: kind === "wrong-target" ? { ...c.target, epoch: randomUUID() } : c.target,
              selection: {
                ...selection,
                kind: kind === "wrong-kind" ? "model" : "thinking",
                modelId: kind === "wrong-model" ? "other" : "model",
                level: kind === "wrong-level" ? "low" : "high",
              },
            },
      );
    });
    await expect(
      bridge.request(agent, targetOf(p.snapshot), { action: "save-default", selection }),
    ).rejects.toThrow("uncertain");
  },
);
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
    // A temporary bridge loss retains history while commands remain disabled.
    p.socket.destroy();
    await nextContaining('"type":"connecting"');
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
