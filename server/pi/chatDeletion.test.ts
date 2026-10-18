import { randomUUID } from "node:crypto";
import { access, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BoardStore } from "../boards/storage.js";
import { HerdrService } from "../herdr/herdrService.js";
import { HerdrClient } from "../herdr/HerdrClient.js";
import { SessionCatalog } from "./sessionCatalog.js";
import { ChatArtifacts } from "./chatArtifacts.js";
import * as images from "../../packages/pi-live-chat/images.js";
import type { Agent } from "../../src/shared/api/contracts.js";

let root: string;
let catalog: SessionCatalog;
let boards: BoardStore;
let service: HerdrService;
let agents: Agent[];
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const key = (session: string, socket = "/fixture/herdr.sock") => JSON.stringify([socket, session]);
const header = (session = "original") => ({ type: "session", id: session, cwd: "/project" });
const refs = (...ids: string[]) => ({
  type: "custom",
  customType: "fernblick-image-uploads",
  data: ids.map((id) => ({ hash: "a".repeat(64), id })),
});
async function save(name: string, entries: unknown[]) {
  const path = join(root, `${name}.jsonl`);
  await writeFile(path, entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n");
  return (await catalog.list()).find((chat) => chat.path === path)!;
}
const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "fb-clean-"));
  vi.stubEnv("FERNBLICK_UPLOAD_DIR", join(root, "uploads"));
  catalog = new SessionCatalog(root);
  boards = new BoardStore(join(root, "boards"));
  service = new HerdrService(
    {} as HerdrClient,
    catalog,
    new ChatArtifacts(boards, "/fixture/herdr.sock"),
  );
  agents = [];
  vi.spyOn(service, "getDashboard").mockImplementation(async () => ({
    agents: agents.map((agent) => ({
      ...agent,
      tab_label: agent.tab_label,
      workspace_label: agent.workspace_label,
    })),
    tabs: [],
    workspaces: [],
  }));
});
afterEach(async () => {
  boards.close();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

it("deletes the conversation, native board/assets, all snapshots and exclusive uploads only", async () => {
  const upload = await images.saveImageUpload(png, "image/png");
  const shared = await images.saveImageUpload(png, "image/png");
  const chat = await save("original", [header(), refs(upload.id, shared.id)]);
  const other = await save("fork", [header("fork"), refs(shared.id)]);
  const board = await boards.open(key("original"));
  const scene = {
    ...board.scene,
    files: {
      picture: {
        id: "picture",
        mimeType: "image/png" as const,
        dataURL: `data:image/png;base64,${png.toString("base64")}`,
        created: 1,
      },
    },
  };
  await boards.save(board.id, 0, scene);
  const snapshot = await boards.capture(board.id, 1, png);
  const orphan = join(root, "boards", `${board.id}.${randomUUID()}.snapshot.json`);
  await writeFile(orphan, "orphaned capture", { mode: 0o600 });
  const otherBoard = await boards.open(key("fork"));
  const projectFile = join(root, "project.txt");
  await writeFile(projectFile, "keep");
  expect(await service.deleteChat(chat.id)).toEqual({
    sessionId: "original",
    boardIds: [board.id],
  });
  expect(await exists(chat.path)).toBe(false);
  expect(await exists(upload.path)).toBe(false);
  expect(await exists(shared.path)).toBe(true);
  expect(await exists(orphan)).toBe(false);
  expect(await exists(other.path)).toBe(true);
  expect(await readFile(projectFile, "utf8")).toBe("keep");
  await expect(boards.read(board.id)).rejects.toMatchObject({ status: 404 });
  await expect(boards.readSnapshot(board.id, snapshot.id)).rejects.toMatchObject({ status: 404 });
  expect((await boards.read(otherBoard.id)).id).toBe(otherBoard.id);
  expect((await readdir(root)).some((name) => name.startsWith(".fernblick-delete-"))).toBe(false);
});

it("cleans legacy boards in this Herdr namespace and owned boards from previous namespaces", async () => {
  const chat = await save("original", [header()]);
  const current = await boards.open(key("original"));
  const old = await boards.open(key("original", "/previous/herdr.sock"));
  await boards.save(old.id, 0, { ...old.scene, background: "#fefefe" });
  expect(JSON.stringify(await boards.read(old.id))).not.toContain("sessionKey");
  expect(JSON.stringify(await boards.read(old.id))).not.toContain("/previous/herdr.sock");
  const path = join(root, "boards", `${current.id}.json`);
  const legacy = JSON.parse(await readFile(path, "utf8"));
  delete legacy.sessionKey;
  await writeFile(path, JSON.stringify(legacy), { mode: 0o600 });
  boards.close();
  boards = new BoardStore(join(root, "boards"));
  service = new HerdrService(
    {} as HerdrClient,
    catalog,
    new ChatArtifacts(boards, "/fixture/herdr.sock"),
  );
  vi.spyOn(service, "getDashboard").mockResolvedValue({ agents: [], tabs: [], workspaces: [] });
  expect((await service.deleteChat(chat.id)).boardIds.sort()).toEqual([current.id, old.id].sort());
  await expect(boards.read(old.id)).rejects.toMatchObject({ status: 404 });
});

it("keeps a board and its snapshots when another conversation still references them", async () => {
  const board = await boards.open(key("original"));
  const snapshot = await boards.capture(board.id, 0, png);
  const chat = await save("original", [header()]);
  // The link may occur on a line too large for metadata JSON parsing.
  await save("fork", [
    header("fork"),
    {
      type: "message",
      message: {
        role: "user",
        content: "x".repeat(1024 * 1024) + `/api/boards/${board.id}/snapshots/${snapshot.id}.png`,
      },
    },
  ]);
  expect((await service.deleteChat(chat.id)).boardIds).toEqual([]);
  expect((await boards.readSnapshot(board.id, snapshot.id)).png).toEqual(png);
});

it("keeps boards and browser drafts belonging to another file for the same Pi session", async () => {
  const chat = await save("original", [header()]);
  await save("copy", [header()]);
  const board = await boards.open(key("original"));
  expect(await service.deleteChat(chat.id)).toEqual({ sessionId: null, boardIds: [] });
  expect((await boards.read(board.id)).id).toBe(board.id);
});

it("restores the transcript after a cleanup failure and allows an idempotent retry", async () => {
  const upload = await images.saveImageUpload(png, "image/png");
  const chat = await save("original", [header(), refs(upload.id)]);
  const board = await boards.open(key("original"));
  const remove = vi
    .spyOn(images, "removeImageUpload")
    .mockRejectedValueOnce(new Error("permission denied"));
  await expect(service.deleteChat(chat.id)).rejects.toMatchObject({ status: 503 });
  expect(await exists(chat.path)).toBe(true);
  expect(await exists(upload.path)).toBe(true);
  await expect(boards.read(board.id)).rejects.toMatchObject({ status: 404 });
  remove.mockRestore();
  await service.deleteChat(chat.id);
  expect(await exists(chat.path)).toBe(false);
  expect(await exists(upload.path)).toBe(false);
});

it("fails closed if any running Pi agent has no reliable session identity", async () => {
  const chat = await save("original", [header()]);
  agents = [
    {
      agent: "pi",
      agent_status: "idle",
      focused: false,
      pane_id: "p1",
      tab_id: "t1",
      workspace_id: "w1",
      revision: 1,
      agent_session: null,
    },
  ];
  await expect(service.deleteChat(chat.id)).rejects.toMatchObject({ status: 409 });
  expect(await exists(chat.path)).toBe(true);
  agents = [];
  await service.deleteChat(chat.id);
  expect(await exists(chat.path)).toBe(false);
});

it("preserves a different session replaced exactly between validation and the rename", async () => {
  const chat = await save("original", [header()]);
  const get = catalog.get.bind(catalog);
  vi.spyOn(catalog, "get").mockImplementationOnce(async (id) => {
    const selected = await get(id);
    await writeFile(chat.path, JSON.stringify(header("replacement")) + "\n");
    return selected;
  });
  const cleanup = vi.fn();
  await expect(catalog.delete(chat.id, cleanup)).rejects.toMatchObject({ status: 409 });
  expect(cleanup).not.toHaveBeenCalled();
  expect(JSON.parse(await readFile(chat.path, "utf8")).id).toBe("replacement");
});

it("fails closed rather than deleting shared files when another saved chat is damaged", async () => {
  const upload = await images.saveImageUpload(png, "image/png");
  const chat = await save("original", [header(), refs(upload.id)]);
  const board = await boards.open(key("original"));
  await writeFile(join(root, "damaged.jsonl"), "unreadable session metadata\n");
  await expect(service.deleteChat(chat.id)).rejects.toMatchObject({ status: 503 });
  expect(await exists(chat.path)).toBe(true);
  expect(await exists(upload.path)).toBe(true);
  expect((await boards.read(board.id)).id).toBe(board.id);
});

it("removes a retained shared board and uploads when their final conversation is deleted", async () => {
  const board = await boards.open(key("original"));
  const snapshot = await boards.capture(board.id, 0, png);
  const upload = await images.saveImageUpload(png, "image/png");
  const entry = {
    type: "message",
    message: {
      role: "user",
      content: `/api/boards/${board.id}/snapshots/${snapshot.id}.png /api/uploads/${upload.id}`,
    },
  };
  const legacyPath = join(root, "boards", `${board.id}.json`);
  const legacy = JSON.parse(await readFile(legacyPath, "utf8"));
  delete legacy.sessionKey;
  await writeFile(legacyPath, JSON.stringify(legacy), { mode: 0o600 });
  const original = await save("original", [header(), refs(upload.id), entry]);
  const fork = await save("fork", [header("fork"), entry]);
  await service.deleteChat(original.id);
  expect((await boards.read(board.id)).id).toBe(board.id);
  expect(await exists(upload.path)).toBe(true);
  expect((await service.deleteChat(fork.id)).boardIds).toContain(board.id);
  await expect(boards.read(board.id)).rejects.toMatchObject({ status: 404 });
  expect(await exists(upload.path)).toBe(false);
});

it("does not remove a referenced board while its owning conversation still exists", async () => {
  const board = await boards.open(key("original"));
  await save("original", [header()]);
  const fork = await save("fork", [
    header("fork"),
    {
      type: "message",
      message: {
        role: "user",
        content: `/api/boards/${board.id}/snapshots/${randomUUID()}.png`,
      },
    },
  ]);
  expect((await service.deleteChat(fork.id)).boardIds).not.toContain(board.id);
  expect((await boards.read(board.id)).id).toBe(board.id);
});

it("replays the deletion result after a lost reply or backend restart without keeping content", async () => {
  const chat = await save("original", [header()]);
  await boards.open(key("original"));
  const result = await service.deleteChat(chat.id);
  const restarted = new HerdrService({} as HerdrClient, new SessionCatalog(root));
  expect(await restarted.deleteChat(chat.id)).toEqual(result);
  const receipt = await readFile(join(root, `.fernblick-deleted-${chat.id}.json`), "utf8");
  expect(JSON.parse(receipt)).toEqual(result);
  expect(receipt).not.toContain(chat.path);
  expect(receipt).not.toContain(chat.title);
});

it("deletes a closed chat alongside an empty session placeholder without weakening shared-file protection", async () => {
  const ownUpload = await images.saveImageUpload(png, "image/png");
  const sharedUpload = await images.saveImageUpload(png, "image/png");
  const chat = await save("original", [header(), refs(ownUpload.id, sharedUpload.id)]);
  const other = await save("other", [header("other"), refs(sharedUpload.id)]);
  const placeholder = join(root, "empty.jsonl");
  await writeFile(placeholder, "");
  const board = await boards.open(key("original"));
  await expect(service.deleteChat(chat.id)).resolves.toEqual({
    sessionId: "original",
    boardIds: [board.id],
  });
  expect(await exists(chat.path)).toBe(false);
  expect(await exists(ownUpload.path)).toBe(false);
  expect(await exists(sharedUpload.path)).toBe(true);
  expect(await exists(other.path)).toBe(true);
  expect(await readFile(placeholder, "utf8")).toBe("");
  await expect(boards.read(board.id)).rejects.toMatchObject({ status: 404 });
});
