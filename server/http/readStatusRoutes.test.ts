import { chmod, mkdtemp, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer as createSocketServer, type Server as SocketServer } from "node:net";
import type { Server } from "node:http";
import { afterEach, beforeEach, expect, it } from "vitest";
import { HerdrClient } from "../herdr/HerdrClient.js";
import { HerdrService } from "../herdr/herdrService.js";
import { LiveBridge } from "../pi/liveBridge.js";
import { createHttpServer } from "./server.js";
import type { Agent } from "../../src/shared/api/contracts.js";

let directory: string;
let socketPath: string;
let herdr: SocketServer;
let server: Server;
let base: string;
let agents: Agent[];
let methods: string[];
let snapshotError: boolean;
let holdSnapshot: ((send: () => void) => void) | undefined;

async function receiptIds() {
  return (await readdir(join(directory, "receipts")))
    .filter((name) => name.endsWith(".read"))
    .map((name) => name.split(".").at(-2))
    .sort();
}

function createHerdrSocket() {
  return createSocketServer((socket) => {
    socket.setEncoding("utf8");
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk;
      if (!buffer.includes("\n")) return;
      const request = JSON.parse(buffer.split("\n")[0]);
      methods.push(request.method);
      if (request.method !== "session.snapshot" || snapshotError) {
        socket.end(
          JSON.stringify({
            id: request.id,
            error: { code: "unavailable", message: "Fixture unavailable" },
          }) + "\n",
        );
        return;
      }
      const reply =
        JSON.stringify({
          id: request.id,
          result: {
            type: "session_snapshot",
            snapshot: {
              agents,
              panes: [],
              tabs: [{ tab_id: "w1:t1", workspace_id: "w1", label: "Agent" }],
              workspaces: [{ workspace_id: "w1", label: "Project" }],
            },
          },
        }) + "\n";
      const hold = holdSnapshot;
      holdSnapshot = undefined;
      if (hold) hold(() => socket.end(reply));
      else socket.end(reply);
    });
  });
}

async function createBackend(path = socketPath) {
  const instance = createHttpServer(
    new HerdrService(new HerdrClient(path)),
    "/unused",
    new LiveBridge("/unused/pi.sock", path),
    undefined,
    { directory: join(directory, "receipts"), herdrSocket: path },
  );
  await new Promise<void>((done) => instance.listen(0, "127.0.0.1", done));
  return {
    server: instance,
    base: `http://127.0.0.1:${(instance.address() as { port: number }).port}`,
  };
}
async function startBackend() {
  ({ server, base } = await createBackend());
}
async function stopBackend(instance = server) {
  instance.closeAllConnections();
  await new Promise<void>((done, reject) =>
    instance.close((error) => (error ? reject(error) : done())),
  );
}
async function dashboard(origin = base) {
  const response = await fetch(`${origin}/api/agents`);
  expect(response.status).toBe(200);
  return (await response.json()) as { agents: Agent[] };
}
async function markRead(paneId: string, completionId: string, origin = base) {
  return fetch(`${origin}/api/agents/${encodeURIComponent(paneId)}/read`, {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({ completionId }),
  });
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "fernblick-read-"));
  socketPath = join(directory, "herdr.sock");
  methods = [];
  snapshotError = false;
  holdSnapshot = undefined;
  agents = [
    {
      agent: "pi",
      agent_status: "done",
      pane_id: "w1:p1",
      terminal_id: "term-1",
      tab_id: "w1:t1",
      workspace_id: "w1",
      focused: false,
      revision: 7,
      state_change_seq: 12,
      agent_session: { agent: "pi", source: "pi", kind: "path", value: "/sessions/one.jsonl" },
    },
  ];
  herdr = createHerdrSocket();
  await new Promise<void>((done) => herdr.listen(socketPath, done));
  await startBackend();
});
afterEach(async () => {
  await stopBackend();
  await new Promise<void>((done) => herdr.close(() => done()));
  await rm(directory, { recursive: true, force: true });
});

it("remembers a read completion across browsers and backend restarts without changing Herdr", async () => {
  const first = (await dashboard()).agents[0];
  expect(first.completion).toEqual({ id: expect.stringMatching(/^[a-f0-9]{64}$/), read: false });
  expect((await markRead(first.pane_id, first.completion!.id)).status).toBe(200);
  // An independent HTTP request represents another browser with no local receipt state.
  expect((await dashboard()).agents[0].completion).toEqual({ ...first.completion, read: true });
  await stopBackend();
  await startBackend();
  expect((await dashboard()).agents[0].completion).toEqual({ ...first.completion, read: true });
  expect((await dashboard()).agents[0].agent_status).toBe("done");
  expect(agents[0].agent_status).toBe("done");
  expect(new Set(methods)).toEqual(new Set(["session.snapshot"]));
});

it("cleans superseded and closed-agent receipts while preserving current answers across restarts", async () => {
  agents.push({ ...agents[0], pane_id: "w1:p2", terminal_id: "term-2" });
  const first = (await dashboard()).agents;
  for (const agent of first) await markRead(agent.pane_id, agent.completion!.id);
  expect(await receiptIds()).toHaveLength(2);
  agents[0].revision++;
  expect((await dashboard()).agents.map((agent) => agent.completion!.read)).toEqual([true, true]);
  expect(await receiptIds()).toHaveLength(2);

  agents[0].state_change_seq = 14;
  const next = (await dashboard()).agents[0];
  expect(next.completion!.read).toBe(false);
  expect(await receiptIds()).toEqual([first[1].completion!.id]);
  await markRead(next.pane_id, next.completion!.id);
  agents.pop();
  await dashboard();
  expect(await receiptIds()).toEqual([next.completion!.id]);
  await stopBackend();
  await startBackend();
  expect((await dashboard()).agents[0].completion!.read).toBe(true);
  expect(await receiptIds()).toEqual([next.completion!.id]);
});

it("ignores unrelated revisions but refuses stale receipts for a newer answer", async () => {
  const first = (await dashboard()).agents[0];
  await markRead(first.pane_id, first.completion!.id);
  agents[0].revision++;
  expect((await dashboard()).agents[0].completion).toEqual({ ...first.completion, read: true });
  agents[0].state_change_seq = 14;
  const next = (await dashboard()).agents[0];
  expect(next.completion!.id).not.toBe(first.completion!.id);
  expect(next.completion!.read).toBe(false);
  expect((await markRead(first.pane_id, first.completion!.id)).status).toBe(409);
  expect((await dashboard()).agents[0].completion!.read).toBe(false);
  await markRead(next.pane_id, next.completion!.id);
  // A delayed old browser cannot overwrite the newer receipt either.
  expect((await markRead(first.pane_id, first.completion!.id)).status).toBe(409);
  expect((await dashboard()).agents[0].completion!.read).toBe(true);
});

it.each(["session", "terminal"])("does not inherit receipts after %s replacement", async (kind) => {
  const first = (await dashboard()).agents[0];
  await markRead(first.pane_id, first.completion!.id);
  if (kind === "session")
    agents[0].agent_session = { ...agents[0].agent_session!, value: "/sessions/two.jsonl" };
  else agents[0].terminal_id = "term-2";
  const next = (await dashboard()).agents[0];
  expect(next.completion!.read).toBe(false);
  expect((await markRead(first.pane_id, first.completion!.id)).status).toBe(409);
});

it.each(["working", "blocked", "unknown", "idle"] as const)(
  "never overrides %s or accepts a stale read while in that state",
  async (status) => {
    const first = (await dashboard()).agents[0];
    await markRead(first.pane_id, first.completion!.id);
    agents[0].agent_status = status;
    const current = (await dashboard()).agents[0];
    expect(current.agent_status).toBe(status);
    expect(current.completion).toBeUndefined();
    expect((await markRead(first.pane_id, first.completion!.id)).status).toBe(409);
  },
);

it("keeps concurrent and repeated acknowledgements without clearing unrelated panes", async () => {
  agents.push(
    { ...agents[0], pane_id: "w1:p2", terminal_id: "term-2" },
    { ...agents[0], pane_id: "w1:p3", terminal_id: "term-3" },
  );
  const first = (await dashboard()).agents;
  const results = await Promise.all(
    [first[0], first[1], first[0]].map((agent) => markRead(agent.pane_id, agent.completion!.id)),
  );
  expect(results.map((response) => response.status)).toEqual([200, 200, 200]);
  await stopBackend();
  await startBackend();
  expect((await dashboard()).agents.map((agent) => agent.completion!.read)).toEqual([
    true,
    true,
    false,
  ]);
});

it.each(["same path", "different path"])(
  "does not reuse receipts when Herdr restarts at the %s",
  async (kind) => {
    const first = (await dashboard()).agents[0];
    await markRead(first.pane_id, first.completion!.id);
    await new Promise<void>((done) => herdr.close(() => done()));
    if (kind === "different path") {
      await stopBackend();
      socketPath = join(directory, "other-herdr.sock");
    }
    await new Promise<void>((done) => herdr.listen(socketPath, done));
    if (kind === "different path") await startBackend();
    const current = (await dashboard()).agents[0];
    expect(current.completion!.read).toBe(false);
    expect(current.completion!.id).not.toBe(first.completion!.id);
    if (kind === "same path") expect(await receiptIds()).not.toContain(first.completion!.id);
    else expect(await receiptIds()).toContain(first.completion!.id);
    expect((await markRead(first.pane_id, first.completion!.id)).status).toBe(409);
  },
);

it("never interprets a failed Herdr snapshot as closed agents", async () => {
  const first = (await dashboard()).agents[0];
  await markRead(first.pane_id, first.completion!.id);
  agents = [];
  snapshotError = true;
  expect((await fetch(`${base}/api/agents`)).status).toBe(503);
  expect(await receiptIds()).toEqual([first.completion!.id]);
  snapshotError = false;
  await dashboard();
  expect(await receiptIds()).toEqual([]);
});

it("does not expire the current receipt just because native Herdr labels it idle", async () => {
  const first = (await dashboard()).agents[0];
  await markRead(first.pane_id, first.completion!.id);
  agents[0].agent_status = "idle";
  await dashboard();
  expect(await receiptIds()).toEqual([first.completion!.id]);
  agents[0].agent_status = "done";
  expect((await dashboard()).agents[0].completion!.read).toBe(true);
});

it("does not clean another live Herdr socket's receipts in shared storage", async () => {
  const first = (await dashboard()).agents[0];
  await markRead(first.pane_id, first.completion!.id);
  const otherSocket = join(directory, "other.sock");
  const otherHerdr = createHerdrSocket();
  await new Promise<void>((done) => otherHerdr.listen(otherSocket, done));
  const other = await createBackend(otherSocket);
  const original = [...agents];
  try {
    const second = (await dashboard(other.base)).agents[0];
    expect(second.completion!.id).not.toBe(first.completion!.id);
    await markRead(second.pane_id, second.completion!.id, other.base);
    agents = [];
    await dashboard(other.base);
    expect(await receiptIds()).toEqual([first.completion!.id]);
    agents = original;
    expect((await dashboard()).agents[0].completion!.read).toBe(true);
  } finally {
    await stopBackend(other.server);
    await new Promise<void>((done) => otherHerdr.close(() => done()));
  }
});

it("a slow refresh cannot delete a newer receipt written by another backend", async () => {
  const first = (await dashboard()).agents[0];
  await markRead(first.pane_id, first.completion!.id);
  const other = await createBackend();
  let release: (() => void) | undefined;
  const captured = new Promise<void>((done) => {
    holdSnapshot = (send) => {
      release = send;
      done();
    };
  });
  const slow = fetch(`${base}/api/agents`);
  try {
    await captured;
    agents[0].state_change_seq = 14;
    const next = (await dashboard(other.base)).agents[0];
    await markRead(next.pane_id, next.completion!.id, other.base);
    release!();
    release = undefined;
    expect((await slow).status).toBe(200);
    expect((await dashboard(other.base)).agents[0].completion!.read).toBe(true);
    expect(await receiptIds()).toEqual([next.completion!.id]);
  } finally {
    release?.();
    await slow;
    await stopBackend(other.server);
  }
});

it("cleanup leaves unrecognized files and symlinks alone", async () => {
  const first = (await dashboard()).agents[0];
  await markRead(first.pane_id, first.completion!.id);
  const root = join(directory, "receipts");
  const own = (await readdir(root))[0];
  const staleLink = own.replace(first.completion!.id, "a".repeat(64));
  const outside = join(directory, "outside");
  await writeFile(outside, "keep me", { mode: 0o600 });
  await symlink(outside, join(root, staleLink));
  await writeFile(join(root, "unrelated.txt"), "keep me");
  agents = [];
  await dashboard();
  expect((await readdir(root)).sort()).toEqual([staleLink, "unrelated.txt"].sort());
});

it("rejects missing agents, invalid receipts and cross-origin writes", async () => {
  const first = (await dashboard()).agents[0];
  expect((await markRead(first.pane_id, "../unsafe")).status).toBe(400);
  expect((await markRead("w1:p99", first.completion!.id)).status).toBe(404);
  for (const origin of [undefined, "https://other.example"]) {
    const response = await fetch(`${base}/api/agents/w1%3Ap1/read`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(origin ? { Origin: origin } : {}) },
      body: JSON.stringify({ completionId: first.completion!.id }),
    });
    expect(response.status).toBe(403);
  }
  expect((await dashboard()).agents[0].completion!.read).toBe(false);
  expect((await fetch(`${base}/api/agents`)).headers.get("cache-control")).toBe("no-store");
});

it("does not report a successful save when the receipt directory is unsafe", async () => {
  const first = (await dashboard()).agents[0];
  await chmod(join(directory, "receipts"), 0o755);
  expect((await markRead(first.pane_id, first.completion!.id)).status).toBe(500);
  await chmod(join(directory, "receipts"), 0o700);
  expect((await dashboard()).agents[0].completion!.read).toBe(false);
  expect((await markRead(first.pane_id, first.completion!.id)).status).toBe(200);
});

it("refuses symlink receipt files rather than reading or writing their targets", async () => {
  const first = (await dashboard()).agents[0];
  const outside = join(directory, "outside");
  await writeFile(outside, "", { mode: 0o600 });
  await markRead(first.pane_id, first.completion!.id);
  const name = (await readdir(join(directory, "receipts"))).find((name) =>
    name.endsWith(`${first.completion!.id}.read`),
  )!;
  const receipt = join(directory, "receipts", name);
  await rm(receipt);
  await symlink(outside, receipt);
  expect((await markRead(first.pane_id, first.completion!.id)).status).toBe(500);
  expect((await fetch(`${base}/api/agents`)).status).toBe(500);
  await rm(receipt);
  expect((await dashboard()).agents[0].completion!.read).toBe(false);
});
