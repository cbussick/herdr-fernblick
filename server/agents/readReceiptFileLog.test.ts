import { randomUUID } from "node:crypto";
import {
  chmod,
  lstat,
  mkdtemp,
  open,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readReceiptRecordSchema } from "../../src/shared/api/readReceiptDiagnostics.js";
import { ReadReceiptFileLog } from "./readReceiptFileLog.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, open: vi.fn(actual.open) };
});

let directory: string;
let writer: ReadReceiptFileLog;
let now: number;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "fernblick-log-"));
  now = Date.now();
  vi.spyOn(Date, "now").mockImplementation(() => now);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(async () => {
  await writer?.close();
  vi.restoreAllMocks();
  await rm(directory, { recursive: true, force: true });
});
function record() {
  return readReceiptRecordSchema.parse({
    event: "read_receipt",
    schemaVersion: 1,
    build: "a".repeat(40),
    severity: "warn",
    timestamp: new Date(now).toISOString(),
    boundary: "persistence",
    operation: "save",
    requestId: randomUUID(),
    category: "storage",
    errorCode: "ENOSPC",
    durationMs: 50,
    suppressed: 0,
    dropped: 0,
  });
}
async function records() {
  const names = (await readdir(directory)).filter((name) => name.endsWith(".ndjson"));
  return (
    await Promise.all(
      names.map(async (name) =>
        (await readFile(join(directory, name), "utf8"))
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line)),
      ),
    )
  ).flat();
}

it("writes only safe structured records, with private files, surviving a new backend writer", async () => {
  writer = new ReadReceiptFileLog({ directory });
  const event = record();
  writer.write({ ...event, ...{ body: "private chat", path: "/sessions/secret" } });
  await writer.close();
  writer = new ReadReceiptFileLog({ directory });
  writer.write(record());
  await writer.flush();
  expect(await records()).toHaveLength(2);
  expect(await records()).toContainEqual(event);
  expect(JSON.stringify(await records())).not.toMatch(/private chat|secret|sessions/);
  expect((await lstat(directory)).mode & 0o777).toBe(0o700);
  for (const name of await readdir(directory))
    expect((await lstat(join(directory, name))).mode & 0o777).toBe(0o600);
});

it("rotates under a total budget and prunes expired segments on a later startup", async () => {
  writer = new ReadReceiptFileLog({ directory, fileBytes: 600, maxBytes: 1200, ageMs: 1000 });
  for (let i = 0; i < 10; i++) {
    writer.write(record());
    await writer.flush();
    now++;
  }
  const names = await readdir(directory);
  const sizes = await Promise.all(names.map((name) => lstat(join(directory, name))));
  expect(sizes.reduce((sum, file) => sum + file.size, 0)).toBeLessThanOrEqual(1200);
  expect(await records()).toHaveLength(2);
  await writer.close();
  now += 1001;
  writer = new ReadReceiptFileLog({ directory, ageMs: 1000 });
  await writer.flush();
  expect(await readdir(directory)).toEqual([]);
});

it("bounds queued records and counts dropped events without making callers wait for disk", async () => {
  writer = new ReadReceiptFileLog({ directory });
  for (let i = 0; i < 300; i++) writer.write(record());
  await writer.flush();
  const saved = await records();
  expect(saved).toHaveLength(128);
  expect(saved.reduce((sum, entry) => sum + entry.dropped, 0)).toBe(172);
});

it("does not follow directory or managed-file symlinks or touch unrelated files", async () => {
  const outside = join(directory, "outside");
  await writeFile(outside, "keep me");
  const link = join(directory, `read-receipt.${now}-${randomUUID()}.ndjson`);
  await symlink(outside, link);
  writer = new ReadReceiptFileLog({ directory });
  expect(() => writer.write(record())).not.toThrow();
  await writer.flush();
  expect(await readFile(outside, "utf8")).toBe("keep me");
  expect(vi.mocked(console.warn)).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain(directory);
  await writer.close();
  const directoryLink = join(directory, "alias");
  await symlink(directory, directoryLink);
  writer = new ReadReceiptFileLog({ directory: directoryLink });
  writer.write(record());
  await writer.flush();
  expect(await readFile(outside, "utf8")).toBe("keep me");
});

it("keeps error capacity when routine records fill their queue allowance", async () => {
  writer = new ReadReceiptFileLog({ directory });
  for (let i = 0; i < 128; i++)
    writer.write({ ...record(), category: "success", severity: "info" });
  writer.write(record());
  await writer.flush();
  const saved = await records();
  expect(saved).toHaveLength(65);
  expect(saved.some((entry) => entry.category === "storage")).toBe(true);
  expect(saved.reduce((sum, entry) => sum + entry.dropped, 0)).toBe(64);
});

it("survives a full disk and emits only a safe error code before recovering", async () => {
  vi.mocked(open).mockRejectedValueOnce(
    Object.assign(new Error("private/path credential"), { code: "ENOSPC" }),
  );
  writer = new ReadReceiptFileLog({ directory });
  writer.write(record());
  await writer.flush();
  expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).toContain("ENOSPC");
  expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toMatch(/credential|private/);
  writer.write(record());
  await writer.flush();
  expect((await records())[0]).toMatchObject({ dropped: 1 });
});

it("survives an unwritable/unsafe destination, recovers and reports dropped writes", async () => {
  await chmod(directory, 0o755);
  writer = new ReadReceiptFileLog({ directory });
  writer.write(record());
  await writer.flush();
  expect(await readdir(directory)).toEqual([]);
  await chmod(directory, 0o700);
  writer.write(record());
  await writer.flush();
  expect((await records())[0]).toMatchObject({ dropped: 1 });
});
