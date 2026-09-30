import { spawnSync } from "node:child_process";
import { chmod, lstat, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { LiveBridge } from "./liveBridge.js";
import {
  parseProcessStat,
  privateDirectory,
  processIdentity,
} from "../../packages/pi-live-chat/security.js";

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});
async function directory() {
  const dir = await mkdtemp(join(tmpdir(), "fb-sec-"));
  dirs.push(dir);
  return dir;
}
it("creates a 0700 directory and 0600 socket; refuses an active server without unlinking it", async () => {
  const dir = await directory();
  const path = join(dir, "private/pi.sock");
  const first = new LiveBridge(path, "/herdr.sock");
  await first.start();
  try {
    expect((await lstat(join(dir, "private"))).mode & 0o777).toBe(0o700);
    const inode = await lstat(path);
    expect(inode.mode & 0o777).toBe(0o600);
    await expect(new LiveBridge(path, "/herdr.sock").start()).rejects.toThrow("already in use");
    expect((await lstat(path)).ino).toBe(inode.ino);
  } finally {
    await first.close();
  }
});
it("refuses public directories, regular files and symlinks without deleting them", async () => {
  const dir = await directory();
  await chmod(dir, 0o755);
  await expect(privateDirectory(join(dir, "pi.sock"), true)).rejects.toThrow("0700");
  await chmod(dir, 0o700);
  const path = join(dir, "pi.sock");
  await writeFile(path, "preserve me", { mode: 0o600 });
  await expect(new LiveBridge(path, "/herdr.sock").start()).rejects.toThrow("0600");
  expect((await lstat(path)).isFile()).toBe(true);
  const link = join(dir, "link.sock");
  await symlink(path, link);
  await expect(new LiveBridge(link, "/herdr.sock").start()).rejects.toThrow("0600");
  expect((await lstat(link)).isSymbolicLink()).toBe(true);
});
it("only removes a refused owned socket left by a crashed test process", async () => {
  const dir = await directory();
  const path = join(dir, "pi.sock");
  const child = spawnSync(process.execPath, [
    "--input-type=module",
    "-e",
    `import {createServer} from 'node:net'; import {chmodSync} from 'node:fs'; const path = process.argv[1]; createServer().listen(path, () => { chmodSync(path, 0o600); process.exit(0); });`,
    path,
  ]);
  expect(child.status).toBe(0);
  expect((await lstat(path)).isSocket()).toBe(true);
  const bridge = new LiveBridge(path, "/herdr.sock");
  await bridge.start();
  await bridge.close();
});
it("parses Linux process identity and rejects nonexistent processes", async () => {
  const fields = ["S", "1", "2", "2", "123", "2", ...Array(13).fill("0"), "456"];
  expect(parseProcessStat(`123 (pi with ) spaces) ${fields.join(" ")}`)).toEqual({
    start: "456",
    foreground: true,
    alive: true,
  });
  const current = await processIdentity(process.pid);
  expect(current.start).toMatch(/^\d+$/);
  await expect(processIdentity(2147483647)).rejects.toThrow();
});
