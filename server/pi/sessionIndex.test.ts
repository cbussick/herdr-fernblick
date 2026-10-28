import {
  appendFile,
  mkdir,
  mkdtemp,
  open,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SessionCatalog } from "./sessionCatalog.js";
import { SessionIndex } from "./sessionIndex.js";

let root: string;
let sessions: string;
let directory: string;
const indexes: SessionIndex[] = [];
const header = { type: "session", id: "session", cwd: "/project" };
const user = { type: "message", message: { role: "user", content: "First prompt" } };
const named = (name: string) => JSON.stringify({ type: "session_info", name }) + "\n";
const save = (path: string) =>
  writeFile(path, [header, user].map((entry) => JSON.stringify(entry)).join("\n") + "\n");
function index() {
  const value = new SessionIndex(new SessionCatalog(sessions), directory);
  indexes.push(value);
  return value;
}
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "fernblick-index-"));
  sessions = join(root, "sessions");
  directory = join(root, "index");
  await mkdir(sessions);
});
afterEach(async () => {
  await Promise.all(indexes.splice(0).map((value) => value.close()));
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});

it("returns immediately while the initial scan is blocked, then publishes cards progressively", async () => {
  await save(join(sessions, "one.jsonl"));
  await save(join(sessions, "two.jsonl"));
  const catalog = new SessionCatalog(sessions);
  const original = catalog.scanMetadata.bind(catalog);
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  let populated!: () => void;
  const firstCard = new Promise<void>((resolve) => {
    populated = resolve;
  });
  let finish!: () => void;
  const remaining = new Promise<void>((resolve) => {
    finish = resolve;
  });
  vi.spyOn(catalog, "scanMetadata").mockImplementation(async (cache) => {
    await blocked;
    await original(cache);
    const [path, entry] = [...cache.entries()][1];
    cache.delete(path);
    populated();
    await remaining;
    cache.set(path, entry);
  });
  const value = new SessionIndex(catalog, directory);
  indexes.push(value);
  await value.start();
  expect(value.snapshot()).toMatchObject({ chats: [], indexing: true });
  release();
  await firstCard;
  expect(value.snapshot()).toMatchObject({ indexing: true, chats: [expect.anything()] });
  finish();
  await value.refresh();
  expect(value.snapshot()).toMatchObject({
    indexing: false,
    chats: [expect.anything(), expect.anything()],
  });
});

it("persists metadata, loads it before scanning after restart, and skips unchanged transcripts", async () => {
  const path = join(sessions, "saved.jsonl");
  await save(path);
  await appendFile(path, named("Old name") + named("Latest name"));
  const first = index();
  await first.start();
  await first.refresh();
  expect(first.snapshot().chats[0].title).toBe("Latest name");
  await first.close();
  const file = await open(path, "r");
  const streams = vi.spyOn(Object.getPrototypeOf(file), "createReadStream");
  await file.close();
  const second = index();
  await second.start();
  // The persisted snapshot is available before the background transcript checks finish.
  expect(second.snapshot().chats[0].title).toBe("Latest name");
  await second.refresh();
  expect(second.snapshot().chats).toEqual(first.snapshot().chats);
  expect(streams).not.toHaveBeenCalled();
  await appendFile(path, named("Another rename"));
  await second.refresh();
  expect(streams).toHaveBeenCalledTimes(1);
  expect(second.snapshot().chats[0].title).toBe("Another rename");
  const persisted = await readFile(second.path, "utf8");
  expect(persisted).not.toContain("uploadIds");
  expect(persisted).not.toContain("boardIds");
});

it("refreshes renames and new files, and removes deleted files", async () => {
  const path = join(sessions, "saved.jsonl");
  await save(path);
  const value = index();
  await value.start();
  await value.refresh();
  const id = value.snapshot().chats[0].id;
  await appendFile(path, named("Renamed"));
  await save(join(sessions, "new.jsonl"));
  await value.refresh();
  expect(value.snapshot().chats).toHaveLength(2);
  expect(value.snapshot().chats.find((chat) => chat.id === id)?.title).toBe("Renamed");
  await rm(path);
  await value.refresh();
  expect(value.snapshot().chats).toHaveLength(1);
});

it("extracts the first prompt and last explicit name without parsing unrelated records", async () => {
  const path = join(sessions, "saved.jsonl");
  const unrelated = JSON.stringify({
    type: "message",
    message: { role: "toolResult", content: "expensive output" },
  });
  await save(path);
  await appendFile(
    path,
    unrelated +
      "\n" +
      named("Earlier name") +
      JSON.stringify({ name: "Final name", type: "session_info" }) +
      "\n",
  );
  const parse = vi.spyOn(JSON, "parse");
  const cache = new Map();
  await new SessionCatalog(sessions).scanMetadata(cache);
  const parsedLines = parse.mock.calls.map(([value]) => value);
  parse.mockRestore();
  expect(parsedLines).not.toContain(unrelated);
  expect([...cache.values()][0].chat).toMatchObject({
    preview: "First prompt",
    title: "Final name",
  });
});

it("checks for changes periodically without a browser request", async () => {
  const value = index();
  vi.useFakeTimers();
  try {
    await value.start();
    await value.refresh();
    await save(join(sessions, "new.jsonl"));
    await vi.advanceTimersByTimeAsync(30_000);
    await value.refresh();
    expect(value.snapshot().chats).toHaveLength(1);
  } finally {
    await value.close();
    vi.useRealTimers();
  }
});

it("keeps metadata scans separate from full asset-reference scans", async () => {
  const upload = "00000000-0000-0000-0000-000000000000.png";
  const board = "a".repeat(64);
  await save(join(sessions, "saved.jsonl"));
  await appendFile(
    join(sessions, "saved.jsonl"),
    JSON.stringify({
      type: "message",
      message: {
        role: "assistant",
        content: `/api/uploads/${upload} /api/boards/${board}/snapshots/test`,
      },
    }) + "\n",
  );
  const catalog = new SessionCatalog(sessions);
  const cache = new Map();
  await catalog.scanMetadata(cache);
  expect([...cache.values()][0].chat).toMatchObject({
    title: "First prompt",
    uploadIds: [],
    boardIds: [],
  });
  expect(await catalog.list(true)).toMatchObject([{ uploadIds: [upload], boardIds: [board] }]);
});

it("rebuilds corrupt indexes and refuses symlinked storage without blocking browsing", async () => {
  await save(join(sessions, "saved.jsonl"));
  await mkdir(directory, { mode: 0o700 });
  const value = index();
  await writeFile(value.path, "not json", { mode: 0o600 });
  await value.start();
  await value.refresh();
  expect(value.snapshot().chats).toHaveLength(1);
  await value.close();
  await rm(directory, { recursive: true });
  const other = join(root, "other");
  await mkdir(other, { mode: 0o700 });
  await symlink(other, directory);
  const unsafe = index();
  await unsafe.start();
  await unsafe.refresh();
  expect(unsafe.snapshot().chats).toHaveLength(1);
  expect(await readFile(value.path, "utf8").catch(() => "missing")).toBe("missing");
});

it("reports scan failures without discarding previously indexed cards and can retry", async () => {
  await save(join(sessions, "saved.jsonl"));
  const catalog = new SessionCatalog(sessions);
  const value = new SessionIndex(catalog, directory);
  indexes.push(value);
  await value.start();
  await value.refresh();
  const spy = vi.spyOn(catalog, "scanMetadata").mockRejectedValueOnce(new Error("private details"));
  await value.refresh();
  expect(value.snapshot()).toMatchObject({
    chats: [expect.anything()],
    indexError: expect.any(String),
    indexing: false,
  });
  expect(value.snapshot().indexError).not.toContain("private details");
  spy.mockRestore();
  await value.refresh();
  expect(value.snapshot().indexError).toBeUndefined();
});
