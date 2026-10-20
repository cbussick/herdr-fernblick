import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, symlink, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createHttpServer } from "./server.js";
import type { HerdrService } from "../herdr/herdrService.js";
import type { LiveBridge } from "../pi/liveBridge.js";
import { MAX_IMAGE_BYTES } from "../../packages/pi-live-chat/protocol.js";
import {
  formatMessageText,
  type MessagePart,
} from "../../src/features/agents/chatMessageFormatting.js";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
  "base64",
);
let directory: string;
let base: string;
let server: ReturnType<typeof createHttpServer>;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "fernblick-local-images-"));
  vi.stubEnv("FERNBLICK_UPLOAD_DIR", join(directory, "unused-uploads"));
  server = createHttpServer({} as HerdrService, directory, {} as LiveBridge);
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterEach(async () => {
  server.closeAllConnections();
  await new Promise<void>((done) => server.close(() => done()));
  vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
});
function image(path: string, headers?: Record<string, string>) {
  return fetch(`${base}/api/local-images?path=${encodeURIComponent(path)}`, { headers });
}
function imageSource(parts: MessagePart[]): string | undefined {
  for (const part of parts) {
    if (part.kind === "image") return part.href;
    const nested = "children" in part ? imageSource(part.children) : undefined;
    if (nested) return nested;
  }
}

it("serves an actual Markdown image from its original file, without creating an attachment", async () => {
  const path = join(directory, "Logo #1 ? 100% ü.png");
  await writeFile(path, png);
  const src = imageSource(formatMessageText(`![Logo](<${encodeURI(path)}>)`));
  expect(src).toBe(`/api/local-images?path=${encodeURIComponent(path)}`);
  const response = await fetch(base + src, { headers: { "Sec-Fetch-Site": "same-origin" } });
  expect(response.status).toBe(200);
  expect(response.headers.get("Content-Type")).toBe("image/png");
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(response.headers.get("Cross-Origin-Resource-Policy")).toBe("same-origin");
  expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
  expect(Buffer.from(await response.arrayBuffer())).toEqual(png);
  expect(await readFile(path)).toEqual(png);
  expect(await readdir(directory)).toEqual(["Logo #1 ? 100% ü.png"]);

  // No saved copy or stale server cache: subsequent requests reflect the source.
  const replacement = Buffer.from("GIF89a");
  await writeFile(path, replacement);
  const updated = await image(path);
  expect(updated.headers.get("Content-Type")).toBe("image/gif");
  expect(Buffer.from(await updated.arrayBuffer())).toEqual(replacement);
  await rm(path);
  const missing = await image(path);
  expect(missing.status).toBe(404);
  expect(await missing.json()).toEqual({ error: "Local image unavailable" });
  expect(await readdir(directory)).toEqual([]);
});

it.each([
  ["image/png", png],
  ["image/jpeg", Buffer.from([255, 216, 0, 255, 217])],
  ["image/gif", Buffer.from("GIF87a")],
  ["image/webp", Buffer.from("RIFF0000WEBP")],
])("detects %s from content, not the filename", async (mime, bytes) => {
  const path = join(directory, "no-extension");
  await writeFile(path, bytes);
  const response = await image(path);
  expect(response.status).toBe(200);
  expect(response.headers.get("Content-Type")).toBe(mime);
  expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
});

it("allows readable image symlinks without making a copy", async () => {
  const path = join(directory, "original.png");
  const alias = join(directory, "alias.png");
  await writeFile(path, png, { mode: 0o644 });
  await symlink(path, alias);
  expect(Buffer.from(await (await image(alias)).arrayBuffer())).toEqual(png);
  expect(await readdir(directory)).toEqual(["alias.png", "original.png"]);
});

it.each([
  "",
  "relative.png",
  "file:///tmp/a.png",
  "https://example.com/a.png",
  "//host/a.png",
  "/tmp/a\0.png",
])("rejects invalid filesystem path %j", async (path) => {
  expect((await image(path)).status).toBe(400);
});

it.each([
  "",
  "private text",
  '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
  "<html>not an image</html>",
])("rejects non-raster content %j without sending the file", async (content) => {
  const path = join(directory, "pretend.png");
  await writeFile(path, content);
  const response = await image(path);
  expect(response.status).toBe(415);
  expect(response.headers.get("Content-Type")).toContain("application/json");
  expect(await response.json()).toEqual({ error: "Local image must be PNG, JPEG, GIF or WebP" });
});

it("accepts 10 MiB but rejects larger files, directories, and FIFOs without blocking", async () => {
  const path = join(directory, "large.png");
  await writeFile(path, png);
  await truncate(path, MAX_IMAGE_BYTES);
  expect((await image(path)).status).toBe(200);
  await truncate(path, MAX_IMAGE_BYTES + 1);
  expect((await image(path)).status).toBe(413);
  expect((await image(directory)).status).toBe(415);
  const fifo = join(directory, "fifo.png");
  await promisify(execFile)("mkfifo", [fifo]);
  expect((await image(fifo)).status).toBe(415);
});

it.each([
  ["Origin", "https://other.example"],
  ["Sec-Fetch-Site", "cross-site"],
  ["Sec-Fetch-Site", "same-site"],
])("rejects another site's image request: %s=%s", async (header, value) => {
  // Access checks take precedence even when the file does not exist.
  expect((await image(join(directory, "missing.png"), { [header]: value })).status).toBe(403);
});

it("accepts same-origin requests and does not add a write endpoint", async () => {
  const path = join(directory, "original.png");
  await writeFile(path, png);
  expect((await image(path, { Origin: base })).status).toBe(200);
  const url = `${base}/api/local-images?path=${encodeURIComponent(path)}`;
  expect((await fetch(url, { method: "POST", body: "replace" })).status).toBe(404);
  expect(await readFile(path)).toEqual(png);
});
