import { access, appendFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { z } from "zod";
import { HerdrClient } from "../herdr/HerdrClient.js";
import { HerdrService } from "../herdr/herdrService.js";
import { LiveBridge } from "../pi/liveBridge.js";
import { SessionCatalog } from "../pi/sessionCatalog.js";
import { ChatArtifacts } from "../pi/chatArtifacts.js";
import { BoardStore } from "../boards/storage.js";
import { saveImageUpload } from "../../packages/pi-live-chat/images.js";
import { createHttpServer } from "./server.js";
import type { Agent } from "../../src/shared/api/contracts.js";

let directory: string;
let server: Server;
let base: string;
let id: string;
let sessionPath: string;
let active: Agent[];
let service: HerdrService;
let boards: BoardStore;
const agent: Agent = {
  agent: "pi",
  agent_status: "idle",
  focused: false,
  pane_id: "w1:p2",
  tab_id: "w1:t2",
  workspace_id: "w1",
  revision: 1,
};
const request = vi.fn();

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "fernblick-history-routes-"));
  sessionPath = join(directory, "saved.jsonl");
  await writeFile(
    sessionPath,
    JSON.stringify({ type: "session", id: "pi-session", cwd: directory }) +
      "\n" +
      JSON.stringify({ type: "session_info", name: "Saved work" }) +
      "\n",
  );
  const catalog = new SessionCatalog(directory);
  id = (await catalog.list())[0].id;
  active = [];
  request.mockReset();
  request.mockImplementation(async <T>(method: string, _params: unknown, schema: z.ZodType<T>) => {
    if (method === "session.snapshot")
      return schema.parse({
        type: "session_snapshot",
        snapshot: {
          agents: active,
          panes: [],
          tabs: [],
          workspaces: [{ workspace_id: "w1", label: "Workspace" }],
        },
      });
    if (method === "tab.create")
      return schema.parse({
        type: "tab_created",
        tab: { tab_id: "w1:t2", workspace_id: "w1", label: "Saved work" },
        root_pane: { pane_id: "w1:p2", revision: 0 },
      });
    if (method === "agent.start") {
      active = [
        {
          ...agent,
          agent_session: { agent: "pi", kind: "path", value: sessionPath, source: "pi" },
        },
      ];
      return schema.parse({ type: "agent_started", agent: active[0] });
    }
    throw new Error(`Unexpected method ${method}`);
  });
  boards = new BoardStore(join(directory, "boards"));
  vi.stubEnv("FERNBLICK_UPLOAD_DIR", join(directory, "uploads"));
  service = new HerdrService(
    { request } as unknown as HerdrClient,
    catalog,
    new ChatArtifacts(boards, join(directory, "herdr.sock")),
  );
  server = createHttpServer(
    service,
    "/unused",
    new LiveBridge(join(directory, "pi.sock"), join(directory, "herdr.sock")),
    boards,
  );
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterEach(async () => {
  boards.close();
  vi.unstubAllEnvs();
  server.closeAllConnections();
  await new Promise<void>((done) => server.close(() => done()));
  await rm(directory, { recursive: true, force: true });
});
const resume = (chatId = id, workspaceId = "w1", origin = base) =>
  fetch(`${base}/api/chats/${chatId}/resume`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify({ workspaceId }),
  });

it("lists metadata without file paths, and resumes the saved session in its original directory", async () => {
  const list = await fetch(`${base}/api/chats`);
  expect(list.headers.get("cache-control")).toBe("no-store");
  expect(await list.json()).toEqual({
    chats: [
      {
        id,
        title: "Saved work",
        preview: "",
        cwd: directory,
        updatedAt: expect.any(String),
        activePaneId: null,
      },
    ],
  });
  const response = await resume();
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ agent });
  expect(request).toHaveBeenCalledWith(
    "tab.create",
    { workspace_id: "w1", label: "Saved work", cwd: directory, focus: false },
    expect.anything(),
  );
  expect(request).toHaveBeenCalledWith(
    "agent.start",
    expect.objectContaining({
      args: [
        "--session",
        sessionPath,
        "--extension",
        expect.stringContaining("pi-live-chat/index"),
      ],
    }),
    expect.anything(),
  );
  expect(await (await fetch(`${base}/api/chats`)).json()).toMatchObject({
    chats: [{ activePaneId: agent.pane_id }],
  });
});

it("opens an already-running chat without creating a duplicate", async () => {
  await resume();
  request.mockClear();
  expect((await resume()).status).toBe(200);
  expect(request.mock.calls.map(([method]) => method)).toEqual(["session.snapshot"]);
});

it("does not duplicate a just-resumed Pi while its session registration catches up", async () => {
  await resume();
  active = [{ ...agent, agent_session: null }];
  request.mockClear();
  expect((await resume()).status).toBe(200);
  expect(request.mock.calls.map(([method]) => method)).toEqual(["session.snapshot"]);
});

it("coalesces simultaneous resume requests", async () => {
  const first = service.resumeChat(id, "w1");
  const second = service.resumeChat(id, "w1");
  expect(first).toBe(second);
  await Promise.all([first, second]);
  expect(request.mock.calls.filter(([method]) => method === "agent.start")).toHaveLength(1);
});

it("rejects cross-origin requests and arbitrary paths before any Herdr mutation", async () => {
  expect((await resume(id, "w1", "https://other.invalid")).status).toBe(403);
  expect((await resume(encodeURIComponent(sessionPath))).status).toBe(404);
  expect((await resume("a".repeat(64))).status).toBe(404);
  expect((await resume(id, "invalid workspace")).status).toBe(400);
  const list = await fetch(`${base}/api/chats`, { headers: { Origin: "https://other.invalid" } });
  expect(list.status).toBe(403);
  expect(request).not.toHaveBeenCalled();
});

it("reports deleted chats, missing workspaces and missing project directories", async () => {
  expect((await resume(id, "w2")).status).toBe(404);
  await writeFile(
    sessionPath,
    JSON.stringify({ type: "session", id: "pi-session", cwd: join(directory, "missing") }) + "\n",
  );
  expect((await resume()).status).toBe(409);
  await rm(sessionPath);
  expect((await resume()).status).toBe(404);
  expect(request.mock.calls.every(([method]) => method === "session.snapshot")).toBe(true);
});

it("reports launch failures instead of claiming a successful resume", async () => {
  const original = request.getMockImplementation()!;
  request.mockImplementation(async (...args) => {
    if (args[0] === "agent.start") throw new Error("Launch failed");
    return original(...args);
  });
  expect((await resume()).status).toBe(500);
});

const deleteChat = (chatId = id, origin: string | null = base) =>
  fetch(`${base}/api/chats/${chatId}`, {
    method: "DELETE",
    headers: origin ? { Origin: origin } : {},
  });

it("deletes only the selected session and removes it from the catalog", async () => {
  const other = join(directory, "other.jsonl");
  await writeFile(other, await readFile(sessionPath));
  expect((await deleteChat()).status).toBe(200);
  await expect(access(sessionPath)).rejects.toMatchObject({ code: "ENOENT" });
  await expect(access(other)).resolves.toBeUndefined();
  const list = await (await fetch(`${base}/api/chats`)).json();
  expect(list.chats).toHaveLength(1);
  expect(list.chats[0].id).not.toBe(id);
  expect((await deleteChat()).status).toBe(200);
  expect((await resume()).status).toBe(404);
  expect(request.mock.calls.every(([method]) => method === "session.snapshot")).toBe(true);
});

it("requires same-origin deletion and rejects arbitrary paths or unknown IDs", async () => {
  expect((await deleteChat(id, "https://other.invalid")).status).toBe(403);
  expect((await deleteChat(id, null)).status).toBe(403);
  expect((await deleteChat(encodeURIComponent(sessionPath))).status).toBe(404);
  expect((await deleteChat("a".repeat(64))).status).toBe(404);
  expect(request).not.toHaveBeenCalled();
  await expect(access(sessionPath)).resolves.toBeUndefined();
});

it.each([false, true])(
  "refuses to delete active chats (registration delayed: %s)",
  async (delayed) => {
    await resume();
    if (delayed) active = [{ ...agent, agent_session: null }];
    const response = await deleteChat();
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "This chat is active. Close it before deleting it.",
    });
    await expect(access(sessionPath)).resolves.toBeUndefined();
  },
);

it("blocks deletion during resume without interrupting the launch", async () => {
  const pending = service.resumeChat(id, "w1");
  await expect(service.deleteChat(id)).rejects.toMatchObject({ status: 409 });
  await pending;
  await expect(access(sessionPath)).resolves.toBeUndefined();
});

it("coalesces deletes and prevents a concurrent resume", async () => {
  const pending = service.deleteChat(id);
  expect(service.deleteChat(id)).toBe(pending);
  await expect(service.resumeChat(id, "w1")).rejects.toMatchObject({ status: 409 });
  await pending;
  await expect(access(sessionPath)).rejects.toMatchObject({ code: "ENOENT" });
  await expect(service.resumeChat(id, "w1")).rejects.toMatchObject({ status: 404 });
});

it("does not delete if active-session detection is unavailable, and allows retry", async () => {
  request.mockRejectedValueOnce(new Error("Herdr unavailable"));
  expect((await deleteChat()).status).toBe(500);
  await expect(access(sessionPath)).resolves.toBeUndefined();
  expect((await deleteChat()).status).toBe(200);
});

it("cascades HTTP deletion and makes old snapshot/upload URLs unavailable", async () => {
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const upload = await saveImageUpload(png, "image/png");
  await appendFile(
    sessionPath,
    JSON.stringify({
      type: "custom",
      customType: "fernblick-image-uploads",
      data: [{ hash: "a".repeat(64), id: upload.id }],
    }) + "\n",
  );
  const board = await boards.open(JSON.stringify([join(directory, "herdr.sock"), "pi-session"]));
  const capture = await boards.capture(board.id, 0, png);
  const url = `${base}/api/boards/${board.id}/snapshots/${capture.id}.png`;
  expect((await fetch(url)).headers.get("cache-control")).toContain("no-store");
  expect((await fetch(base + upload.url)).headers.get("cache-control")).toContain("no-store");
  const response = await deleteChat();
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    ok: true,
    sessionId: "pi-session",
    boardIds: [board.id],
  });
  expect((await fetch(url)).status).toBe(404);
  expect((await fetch(base + upload.url)).status).toBe(404);
});
