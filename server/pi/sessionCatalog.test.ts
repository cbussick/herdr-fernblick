import {
  access,
  appendFile,
  mkdir,
  mkdtemp,
  rm,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { SessionCatalog } from "./sessionCatalog.js";

let root: string;
let catalog: SessionCatalog;
const header = { type: "session", id: "saved-session", version: 3, cwd: "/project" };
const user = (content: unknown) => ({ type: "message", message: { role: "user", content } });
async function save(path: string, entries: unknown[]) {
  await writeFile(path, entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n");
}
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "fernblick-sessions-"));
  catalog = new SessionCatalog(root);
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

it("discovers flat and grouped sessions, uses latest names and sorts by modification time", async () => {
  await mkdir(join(root, "project"));
  await save(join(root, "project", "old.jsonl"), [
    header,
    user("Initial question"),
    { type: "session_info", name: "Old title" },
    { type: "session_info", name: "Named chat" },
  ]);
  await utimes(join(root, "project", "old.jsonl"), 1, 1);
  await save(join(root, "new.jsonl"), [
    header,
    user([
      { type: "image", data: "private" },
      { type: "text", text: "A new\nquestion" },
    ]),
  ]);
  const chats = await catalog.list();
  expect(chats.map((chat) => chat.title)).toEqual(["A new question", "Named chat"]);
  expect(chats[0]).toMatchObject({
    cwd: "/project",
    preview: "A new question",
    id: expect.stringMatching(/^[a-f0-9]{64}$/),
  });
  expect(JSON.stringify(chats)).not.toContain("private");
  expect(await catalog.get(chats[0].id)).toEqual(chats[0]);
});

it("refreshes changed metadata, retains stable IDs and evicts removed files", async () => {
  const path = join(root, "saved.jsonl");
  await save(path, [header]);
  const [original] = await catalog.list();
  expect(original.title).toBe("Untitled session");
  await appendFile(path, JSON.stringify({ type: "session_info", name: "Renamed" }) + "\n");
  expect(await catalog.get(original.id)).toMatchObject({ id: original.id, title: "Renamed" });
  await rm(path);
  expect(await catalog.list()).toEqual([]);
  await expect(catalog.get(original.id)).rejects.toMatchObject({ status: 404 });
  await expect(catalog.get("../../outside.jsonl")).rejects.toMatchObject({ status: 404 });
});

it("skips symlinked files/directories and invalid headers without hiding valid chats", async () => {
  await save(join(root, "valid.jsonl"), [header, user("Keep me")]);
  await writeFile(join(root, "bad.jsonl"), "not json\n");
  await save(join(root, "invalid.jsonl"), [{ ...header, cwd: "relative" }]);
  await symlink(join(root, "valid.jsonl"), join(root, "link.jsonl"));
  await symlink(root, join(root, "linked-directory"));
  expect((await catalog.list()).map((chat) => chat.title)).toEqual(["Keep me"]);
});

it("bounds oversized lines and tolerates partial trailing writes", async () => {
  const path = join(root, "large.jsonl");
  await save(path, [
    header,
    { type: "message", message: { role: "toolResult", content: "x".repeat(2 * 1024 * 1024) } },
    user("After large output"),
  ]);
  await appendFile(path, '{"type":"message"');
  expect((await catalog.list())[0].title).toBe("After large output");
});

it("does not resume a different session that replaced a previously listed file", async () => {
  const path = join(root, "replaced.jsonl");
  await save(path, [header]);
  const [original] = await catalog.list();
  await save(path, [{ ...header, id: "different-session" }]);
  await expect(catalog.get(original.id)).rejects.toMatchObject({ status: 404 });
});

it("treats a missing directory as empty", async () => {
  expect(await new SessionCatalog(join(root, "missing")).list()).toEqual([]);
});

it("deletes grouped sessions and evicts cached metadata", async () => {
  await mkdir(join(root, "project"));
  const path = join(root, "project", "saved.jsonl");
  await save(path, [header]);
  const [chat] = await catalog.list();
  await catalog.delete(chat.id);
  await expect(access(path)).rejects.toMatchObject({ code: "ENOENT" });
  expect(await catalog.list()).toEqual([]);
  await expect(catalog.delete(chat.id)).rejects.toMatchObject({ status: 404 });
});

it("does not delete a replacement session or follow a replaced symlink", async () => {
  const path = join(root, "saved.jsonl");
  const other = join(root, "other.jsonl");
  await save(path, [header]);
  const [chat] = await catalog.list();
  await save(path, [{ ...header, id: "replacement" }]);
  await expect(catalog.delete(chat.id)).rejects.toMatchObject({ status: 404 });
  await expect(access(path)).resolves.toBeUndefined();
  await save(other, [header]);
  await rm(path);
  await symlink(other, path);
  await expect(catalog.delete(chat.id)).rejects.toMatchObject({ status: 404 });
  await expect(access(other)).resolves.toBeUndefined();
});

it("ignores empty placeholders in strict scans and discovers them once initialized", async () => {
  const path = join(root, "placeholder.jsonl");
  await writeFile(path, "");
  expect(await catalog.list(true)).toEqual([]);
  const uploadId = "00000000-0000-0000-0000-000000000000.png";
  await save(path, [
    header,
    { type: "custom", customType: "fernblick-image-uploads", data: [{ id: uploadId }] },
  ]);
  expect(await catalog.list(true)).toMatchObject([{ sessionId: header.id, uploadIds: [uploadId] }]);
});
