import { chmod, link, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { saveImageUpload, readImageUpload } from "./imageUploads.js";
import { prepareImages } from "../../packages/pi-live-chat/images.js";
import { createHttpServer } from "../http/server.js";
import type { HerdrService } from "../herdr/herdrService.js";
import type { LiveBridge } from "../pi/liveBridge.js";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "fb-img-"));
  vi.stubEnv("FERNBLICK_UPLOAD_DIR", dir);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});
const examples = [
  ["image/png", Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])],
  ["image/jpeg", Buffer.from([255, 216, 0, 255, 217])],
  ["image/gif", Buffer.from("GIF89a")],
  ["image/webp", Buffer.from("RIFF0000WEBP")],
] as const;
it.each(examples)(
  "uploads and safely prepares %s as typed ImageContent",
  async (mimeType, bytes) => {
    const saved = await saveImageUpload(bytes, mimeType);
    expect(await readImageUpload(saved.id)).toEqual(bytes);
    expect(await prepareImages([saved.id])).toEqual([
      { type: "image", data: bytes.toString("base64"), mimeType },
    ]);
  },
);
it("rejects traversal, mismatched magic, oversized files, symlinks, hard links and public files/directories", async () => {
  await expect(readImageUpload("../../secret.png")).rejects.toThrow();
  await expect(saveImageUpload(Buffer.from("not png"), "image/png")).rejects.toThrow();
  const id = `${randomUUID()}.png`;
  const bytes = Buffer.alloc(10 * 1024 * 1024 + 1);
  examples[0][1].copy(bytes);
  await writeFile(join(dir, id), bytes, { mode: 0o600 });
  await expect(readImageUpload(id)).rejects.toThrow("oversized");
  const saved = await saveImageUpload(examples[0][1], "image/png");
  const linked = `${randomUUID()}.png`;
  await symlink(saved.path, join(dir, linked));
  await expect(readImageUpload(linked)).rejects.toThrow();
  const hard = `${randomUUID()}.png`;
  await link(saved.path, join(dir, hard));
  await expect(readImageUpload(hard)).rejects.toThrow("Unsafe");
  await rm(join(dir, hard));
  await chmod(saved.path, 0o644);
  await expect(readImageUpload(saved.id)).rejects.toThrow("Unsafe");
  await chmod(saved.path, 0o600);
  await chmod(dir, 0o755);
  await expect(readImageUpload(saved.id)).rejects.toThrow("0700");
});
it("keeps the HTTP 10 MiB upload limit and accepts image-only commands with four IDs, not base64", async () => {
  const request = vi.fn(async () => ({ type: "ack", id: randomUUID(), outcome: "invoked" }));
  const service = { getAgent: vi.fn(async () => ({ pane_id: "p1" })) } as unknown as HerdrService;
  const server = createHttpServer(service, dir, { request } as unknown as LiveBridge);
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    const bytes = Buffer.alloc(10 * 1024 * 1024);
    examples[0][1].copy(bytes);
    const response = await fetch(base + "/api/uploads/images", {
      method: "POST",
      headers: { Origin: base, "Content-Type": "image/png" },
      body: bytes,
    });
    expect(response.status).toBe(201);
    const saved = (await response.json()) as { id: string; url: string };
    expect((await (await fetch(base + saved.url)).arrayBuffer()).byteLength).toBe(bytes.length);
    const target = { runtime: randomUUID(), epoch: randomUUID(), sessionId: "session" };
    const send = (attachments: string[]) =>
      fetch(base + "/api/agents/p1/prompt", {
        method: "POST",
        headers: { Origin: base, "Content-Type": "application/json" },
        body: JSON.stringify({ target, text: "", attachments }),
      });
    expect((await send(Array(4).fill(saved.id))).status).toBe(200);
    expect(request).toHaveBeenCalledWith(expect.anything(), target, {
      action: "send",
      text: "",
      attachments: Array(4).fill(saved.id),
    });
    expect((await send([])).status).toBe(400);
    expect((await send(Array(5).fill(saved.id))).status).toBe(400);
    const oversized = await fetch(base + "/api/uploads/images", {
      method: "POST",
      headers: { Origin: base, "Content-Type": "image/png" },
      body: Buffer.concat([bytes, Buffer.from([0])]),
    });
    expect(oversized.status).toBe(413);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
  }
});
