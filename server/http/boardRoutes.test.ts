import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile, readdir } from "node:fs/promises";
import { connect, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Server } from "node:http";
import type { Agent } from "../../src/shared/api/contracts.js";
import type { HerdrService } from "../herdr/herdrService.js";
import { LiveBridge } from "../pi/liveBridge.js";
import { BoardStore } from "../boards/storage.js";
import { createHttpServer } from "./server.js";
import { targetOf, type Snapshot } from "../../packages/pi-live-chat/protocol.js";
import {
  type BoardGrant,
  type BoardRequest,
  type BoardState,
} from "../../packages/pi-live-chat/boardProtocol.js";
import { receiveFrames, writeFrame } from "../../packages/pi-live-chat/transport.js";

const agent: Agent = {
  agent: "pi",
  pane_id: "w1:p1",
  agent_status: "idle",
  focused: false,
  revision: 1,
  workspace_id: "w1",
  tab_id: "w1:t1",
  agent_session: {
    agent: "pi",
    kind: "path",
    source: "pi",
    value: "/session.jsonl",
  },
};
let directory: string;
let bridge: LiveBridge;
let boards: BoardStore;
let server: Server;
let socket: Socket;
let base: string;
let snapshot: Snapshot;
let frames: Record<string, unknown>[];
let acceptSend: boolean;
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
  "base64",
);
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "fb-board-http-"));
  vi.stubEnv("FERNBLICK_UPLOAD_DIR", join(directory, "uploads"));
  frames = [];
  acceptSend = true;
  bridge = new LiveBridge(join(directory, "pi.sock"), "/herdr.sock", async () => ({
    start: "456",
    foreground: true,
    alive: true,
    pane: agent.pane_id,
    herdrSocket: "/herdr.sock",
  }));
  boards = new BoardStore(join(directory, "boards"));
  await bridge.start();
  server = createHttpServer(
    { getAgent: vi.fn(async () => agent) } as unknown as HerdrService,
    directory,
    bridge,
    boards,
  );
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  snapshot = {
    type: "snapshot",
    version: 2,
    capabilities: { boards: true },
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
  };
  socket = connect(bridge.path);
  await new Promise<void>((done) => socket.once("connect", done));
  receiveFrames(socket, (raw) => {
    const frame = raw as Record<string, unknown>;
    frames.push(frame);
    if (frame.type === "command")
      writeFrame(socket, {
        type: "ack",
        id: frame.id,
        outcome: acceptSend ? "invoked" : "rejected",
        reason: acceptSend ? undefined : "Rejected by test Pi",
      });
  });
  writeFrame(socket, snapshot);
  await vi.waitFor(() => expect(bridge.current(agent).snapshot.seq).toBe(1));
});
afterEach(async () => {
  vi.unstubAllEnvs();
  socket?.destroy();
  server?.closeAllConnections();
  if (server) await new Promise<void>((done) => server.close(() => done()));
  await bridge?.close();
  boards?.close();
  await rm(directory, { recursive: true, force: true });
});
async function post(action = "", extra: Record<string, unknown> = {}, origin = base) {
  return fetch(`${base}/api/agents/w1:p1/board${action ? `/${action}` : ""}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify({ target: targetOf(snapshot), ...extra }),
  });
}
async function open() {
  const response = await post();
  expect(response.status).toBe(200);
  return (await response.json()) as BoardState;
}
async function upload() {
  const response = await fetch(`${base}/api/uploads/images`, {
    method: "POST",
    headers: { Origin: base, "Content-Type": "image/png" },
    body: png,
  });
  expect(response.status).toBe(201);
  return ((await response.json()) as { id: string }).id;
}
async function send(mode: "image" | "edit", state: BoardState) {
  const requestId = randomUUID();
  const response = await post(mode === "image" ? "send" : "prompt", {
    ...(mode === "image"
      ? { mode, uploadId: await upload() }
      : state.scene.elements.some((element) => !element.isDeleted)
        ? { uploadId: await upload() }
        : {}),
    boardId: state.id,
    revision: state.revision,
    text: "Review this",
    requestId,
  });
  return {
    response,
    requestId,
    command: frames.filter((f) => f.type === "command").at(-1),
  };
}
async function rpc(
  grant: BoardGrant,
  action: BoardRequest["action"],
  extra: Partial<BoardRequest> = {},
) {
  const id = randomUUID();
  writeFrame(socket, {
    type: "board-request",
    id,
    target: targetOf(snapshot),
    grantId: grant.grantId,
    boardId: grant.boardId,
    action,
    ...extra,
  });
  await vi.waitFor(() =>
    expect(frames.some((f) => f.type === "board-reply" && f.id === id)).toBe(true),
  );
  return frames.find((f) => f.type === "board-reply" && f.id === id)!;
}
it("persists a conversation board and denies foreign origins, boards and stale targets", async () => {
  const state = await open();
  expect((await open()).id).toBe(state.id);
  expect((await post("", {}, "https://foreign.invalid")).status).toBe(403);
  expect(
    (
      await post("save", {
        boardId: "a".repeat(64),
        baseRevision: 0,
        scene: state.scene,
      })
    ).status,
  ).toBe(403);
  expect((await post("", { target: { ...targetOf(snapshot), epoch: randomUUID() } })).status).toBe(
    409,
  );
  const scene = { ...state.scene, background: "#e7f2fc" };
  const saved = await post("save", {
    boardId: state.id,
    baseRevision: 0,
    scene,
  });
  expect(saved.status).toBe(200);
  expect(await saved.json()).toMatchObject({ revision: 1, scene });
  expect((await post("save", { boardId: state.id, baseRevision: 0, scene })).status).toBe(409);
});
it("empty-board prompts grant editing without PNGs or snapshots, and each later prompt gets fresh access", async () => {
  const state = await open();
  async function prompt(text: string) {
    const requestId = randomUUID();
    const response = await post("prompt", {
      boardId: state.id,
      revision: state.revision,
      text,
      requestId,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      id: requestId,
      outcome: "invoked",
    });
    return frames.filter((f) => f.type === "command").at(-1)!;
  }
  const first = await prompt("Draw an elephant");
  expect(first.attachments).toEqual([]);
  expect(first.text).toBe("Draw an elephant");
  const grant = first.board as BoardGrant;
  expect(grant.mode).toBe("edit");
  expect((await open()).snapshots).toHaveLength(0);
  expect(await rpc(grant, "activate")).toMatchObject({ ok: true });
  expect(await rpc(grant, "read")).toMatchObject({ ok: true });
  const second = await prompt("Add a trunk");
  expect((second.board as BoardGrant).grantId).not.toBe(grant.grantId);
  expect(await rpc(grant, "read")).toMatchObject({ ok: false });
  expect((await open()).access?.mode).toBe("edit");
});
it("forwards a board PNG together with editing access, without creating a saved snapshot", async () => {
  const initial = await open();
  const state = await boards.save(initial.id, 0, {
    ...initial.scene,
    elements: [
      {
        id: "handwriting",
        type: "freedraw",
        x: 0,
        y: 0,
        width: 30,
        height: 20,
        points: [
          [0, 0],
          [30, 20],
        ],
      },
    ],
  });
  const uploadId = await upload();
  const response = await post("prompt", {
    boardId: state.id,
    revision: state.revision,
    text: "Finish the sentence",
    requestId: randomUUID(),
    uploadId,
  });
  expect(response.status).toBe(200);
  const command = frames.filter((f) => f.type === "command").at(-1)!;
  expect(command.attachments).toEqual([uploadId]);
  expect(command.text).toBe("Finish the sentence");
  const grant = command.board as BoardGrant;
  expect(grant).toMatchObject({
    boardId: state.id,
    mode: "edit",
    revision: state.revision,
  });
  expect(await rpc(grant, "activate")).toMatchObject({ ok: true });
  expect(await rpc(grant, "read")).toMatchObject({
    ok: true,
    data: { elements: [{ type: "freedraw" }] },
  });
  expect((await open()).snapshots).toHaveLength(0);
});
it.each(["missing", "non-PNG", "unknown", "corrupt"])(
  "rejects %s visual context without forwarding or granting",
  async (kind) => {
    const initial = await open();
    const state = await boards.save(initial.id, 0, {
      ...initial.scene,
      elements: [
        {
          id: "ink",
          type: "freedraw",
          x: 0,
          y: 0,
          width: 30,
          height: 20,
          points: [
            [0, 0],
            [30, 20],
          ],
        },
      ],
    });
    let uploadId: string | undefined;
    if (kind === "non-PNG") uploadId = randomUUID() + ".jpg";
    if (kind === "unknown") uploadId = randomUUID() + ".png";
    if (kind === "corrupt") {
      uploadId = await upload();
      await writeFile(join(directory, "uploads", uploadId), "broken", {
        mode: 0o600,
      });
    }
    const response = await post("prompt", {
      boardId: state.id,
      revision: state.revision,
      text: "Read this",
      requestId: randomUUID(),
      uploadId,
    });
    expect(response.status).toBe(400);
    expect((await open()).access).toBeNull();
    expect((await open()).snapshots).toHaveLength(0);
    expect(frames.filter((f) => f.type === "command")).toHaveLength(0);
  },
);
it("rejects a visual prompt for an old revision, and revokes its grant on a failed ACK", async () => {
  const state = await open();
  const uploadId = await upload();
  const value = {
    boardId: state.id,
    revision: 0,
    text: "Read this",
    requestId: randomUUID(),
    uploadId,
  };
  await boards.save(state.id, 0, { ...state.scene, background: "#123456" });
  expect((await post("prompt", value)).status).toBe(409);
  expect(frames.filter((f) => f.type === "command")).toHaveLength(0);
  acceptSend = false;
  expect((await post("prompt", { ...value, revision: 1, requestId: randomUUID() })).status).toBe(
    409,
  );
  expect((await open()).access).toBeNull();
  expect((await open()).snapshots).toHaveLength(0);
  expect(
    (await readdir(join(directory, "boards"))).filter((name) => name.endsWith(".snapshot.json")),
  ).toEqual([]);
});
it("whiteboard prompts reject foreign/stale/changed/unsupported targets, blanks and client-supplied attachments", async () => {
  const state = await open();
  const valid = {
    boardId: state.id,
    revision: 0,
    text: "Draw",
    requestId: randomUUID(),
  };
  expect((await post("prompt", valid, "https://foreign.invalid")).status).toBe(403);
  expect((await post("prompt", { ...valid, boardId: "a".repeat(64) })).status).toBe(403);
  expect(
    (
      await post("prompt", {
        ...valid,
        target: { ...targetOf(snapshot), epoch: randomUUID() },
      })
    ).status,
  ).toBe(409);
  expect((await post("prompt", { ...valid, revision: 99 })).status).toBe(409);
  expect((await post("prompt", { ...valid, text: " " })).status).toBe(400);
  expect((await post("prompt", { ...valid, attachments: [] })).status).toBe(400);
  snapshot = { ...snapshot, seq: 2, capabilities: undefined };
  writeFrame(socket, snapshot);
  await vi.waitFor(() => expect(bridge.current(agent).snapshot.seq).toBe(2));
  expect((await post("prompt", valid)).status).toBe(409);
  expect((await open()).access).toBeNull();
  expect(frames.filter((f) => f.type === "command")).toHaveLength(0);
});
it("rejected whiteboard-mode forwarding revokes access and does not create a snapshot", async () => {
  const state = await open();
  acceptSend = false;
  expect(
    (
      await post("prompt", {
        boardId: state.id,
        revision: 0,
        text: "Draw",
        requestId: randomUUID(),
      })
    ).status,
  ).toBe(409);
  expect((await open()).access).toBeNull();
  expect((await open()).snapshots).toHaveLength(0);
});
it("image sends retain immutable snapshots without granting tools", async () => {
  const state = await open();
  const sent = await send("image", state);
  expect(sent.response.status).toBe(200);
  expect(await sent.response.json()).toMatchObject({
    id: sent.requestId,
    outcome: "invoked",
  });
  expect(sent.command?.board).toBeUndefined();
  expect(
    (
      await post("send", {
        boardId: state.id,
        revision: 0,
        uploadId: await upload(),
        mode: "edit",
        text: "Draw",
        requestId: randomUUID(),
      })
    ).status,
  ).toBe(400);
  const fresh = await open();
  expect(fresh.access).toBeNull();
  expect(fresh.snapshots).toHaveLength(1);
  const capture = fresh.snapshots[0];
  const url = `/api/boards/${state.id}/snapshots/${capture.id}`;
  expect(Buffer.from(await (await fetch(base + url + ".png")).arrayBuffer())).toEqual(png);
  await post("save", {
    boardId: state.id,
    baseRevision: 0,
    scene: { ...state.scene, background: "#123456" },
  });
  const json = (await (await fetch(base + url + ".json")).json()) as {
    appState: { viewBackgroundColor: string };
  };
  expect(json.appState.viewBackgroundColor).toBe("#ffffff");
  const forged = {
    boardId: state.id,
    grantId: randomUUID(),
    mode: "edit" as const,
    revision: 0,
  };
  expect(await rpc(forged, "activate")).toMatchObject({ ok: false });
});
it("agent edits work without a browser and stale revisions/revoked grants fail closed", async () => {
  const state = await open();
  const sent = await send("edit", state);
  expect(sent.response.status).toBe(200);
  const grant = sent.command!.board as BoardGrant;
  expect((await open()).access).toMatchObject({
    state: "pending",
    mode: "edit",
  });
  expect(await rpc(grant, "read")).toMatchObject({ ok: false });
  expect(await rpc(grant, "activate")).toMatchObject({ ok: true });
  const operationId = randomUUID();
  const input = {
    baseRevision: 0,
    operationId,
    operations: [
      {
        op: "create" as const,
        id: "agent-box",
        kind: "rectangle" as const,
        x: 100,
        y: 200,
      },
    ],
  };
  expect(await rpc(grant, "apply", input)).toMatchObject({
    ok: true,
    data: { revision: 1 },
  });
  expect(await rpc(grant, "apply", input)).toMatchObject({
    ok: true,
    data: { revision: 1 },
  });
  expect(await rpc(grant, "apply", { ...input, operationId: randomUUID() })).toMatchObject({
    ok: false,
  });
  expect((await open()).scene.elements).toMatchObject([{ id: "agent-box", x: 100, y: 200 }]);
  expect((await post("revoke", { boardId: state.id })).status).toBe(200);
  expect(frames.some((f) => f.type === "board-revoke" && f.grantId === grant.grantId)).toBe(true);
  expect(await rpc(grant, "read")).toMatchObject({ ok: false });
  const next = await send("edit", await open());
  const nextGrant = next.command!.board as BoardGrant;
  expect(await rpc(nextGrant, "activate")).toMatchObject({ ok: true });
  expect(await rpc(nextGrant, "read")).toMatchObject({
    ok: true,
    data: { revision: 1 },
  });
});
it("merges agent additions and unchanged-target edits after human saves, but rejects changed targets", async () => {
  const initial = await open();
  expect(
    (
      await post("save", {
        boardId: initial.id,
        baseRevision: 0,
        scene: {
          ...initial.scene,
          elements: [
            {
              id: "human-box",
              type: "rectangle",
              x: 0,
              y: 0,
              width: 30,
              height: 40,
            },
          ],
        },
      })
    ).status,
  ).toBe(200);
  const sent = await send("edit", await open());
  const grant = sent.command!.board as BoardGrant;
  expect(await rpc(grant, "activate")).toMatchObject({ ok: true });
  expect(await rpc(grant, "read")).toMatchObject({ ok: true, data: { revision: 1 } });
  const before = await open();
  expect(
    (
      await post("save", {
        boardId: before.id,
        baseRevision: 1,
        scene: {
          ...before.scene,
          elements: [
            ...before.scene.elements,
            {
              id: "handwriting",
              type: "freedraw",
              x: 10,
              y: 10,
              width: 10,
              height: 10,
              points: [
                [0, 0],
                [10, 10],
              ],
            },
          ],
        },
      })
    ).status,
  ).toBe(200);
  expect(
    await rpc(grant, "apply", {
      baseRevision: 1,
      operationId: randomUUID(),
      operations: [
        { op: "create", id: "agent-box", kind: "rectangle", x: 100, y: 100 },
        { op: "update", id: "human-box", x: 50 },
      ],
    }),
  ).toMatchObject({ ok: true, data: { revision: 3 } });
  const merged = await open();
  expect(merged.scene.elements.map((e: { id: string }) => e.id)).toEqual([
    "human-box",
    "handwriting",
    "agent-box",
  ]);
  expect(await rpc(grant, "read")).toMatchObject({ ok: true, data: { revision: 3 } });
  expect(
    (
      await post("save", {
        boardId: merged.id,
        baseRevision: 3,
        scene: {
          ...merged.scene,
          elements: merged.scene.elements.map((e: { id: string }) =>
            e.id === "human-box" ? { ...e, x: 99 } : e,
          ),
        },
      })
    ).status,
  ).toBe(200);
  expect(
    await rpc(grant, "apply", {
      baseRevision: 3,
      operationId: randomUUID(),
      operations: [
        { op: "create", id: "must-not-appear", kind: "rectangle", x: 0, y: 0 },
        { op: "delete", id: "human-box" },
      ],
    }),
  ).toMatchObject({
    ok: true,
    data: {
      applied: ["must-not-appear"],
      skipped: [{ id: "human-box", reason: expect.stringContaining("changed") }],
    },
  });
  expect((await open()).revision).toBe(5);
  expect((await open()).scene.elements).toHaveLength(4);
});

it("revokes on settlement, epoch change and connection loss; old extensions cannot get grants", async () => {
  const first = await send("edit", await open());
  const grant = first.command!.board as BoardGrant;
  await rpc(grant, "activate");
  writeFrame(socket, { ...snapshot, seq: 2, busy: true });
  await vi.waitFor(() => expect(bridge.current(agent).snapshot.busy).toBe(true));
  writeFrame(socket, { ...snapshot, seq: 3 });
  await vi.waitFor(async () => expect((await open()).access).toBeNull());
  expect(await rpc(grant, "read")).toMatchObject({ ok: false });
  snapshot = { ...snapshot, seq: 4, capabilities: undefined };
  writeFrame(socket, snapshot);
  await vi.waitFor(() => expect(bridge.current(agent).snapshot.seq).toBe(4));
  expect((await send("edit", await open())).response.status).toBe(409);
  snapshot = { ...snapshot, seq: 5, capabilities: { boards: true } };
  writeFrame(socket, snapshot);
  await vi.waitFor(() => expect(bridge.current(agent).snapshot.seq).toBe(5));
  const next = await send("edit", await open());
  const secondGrant = next.command!.board as BoardGrant;
  await rpc(secondGrant, "activate");
  snapshot = { ...snapshot, seq: 1, epoch: randomUUID() };
  writeFrame(socket, snapshot);
  await vi.waitFor(async () => expect((await open()).access).toBeNull());
  const last = await send("edit", await open());
  const lastGrant = last.command!.board as BoardGrant;
  await rpc(lastGrant, "activate");
  socket.destroy();
  await vi.waitFor(async () => expect((await boards.read(lastGrant.boardId)).access).toBeNull());
});
it("rejects a failed forwarding ACK without retaining permission, and sends board invalidations over SSE", async () => {
  const state = await open();
  const query = new URLSearchParams(targetOf(snapshot));
  const abort = new AbortController();
  const events = await fetch(`${base}/api/agents/w1:p1/board/events?${query}`, {
    signal: abort.signal,
  });
  expect(events.headers.get("content-type")).toBe("text/event-stream");
  const reader = events.body!.getReader();
  const first = await reader.read();
  expect(new TextDecoder().decode(first.value)).toContain('"type":"changed"');
  const save = await post("save", {
    boardId: state.id,
    baseRevision: 0,
    scene: { ...state.scene, background: "#123456" },
  });
  expect(save.status).toBe(200);
  const changed = await reader.read();
  expect(new TextDecoder().decode(changed.value)).toContain('"revision":1');
  abort.abort();
  await reader.cancel().catch(() => {});
  acceptSend = false;
  const rejected = await send("edit", await open());
  expect(rejected.response.status).toBe(409);
  expect((await open()).access).toBeNull();
});
