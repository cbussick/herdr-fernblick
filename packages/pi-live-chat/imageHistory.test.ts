import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { IMAGE_METADATA, ImageHistory } from "./imageHistory.js";
import { projectMessage } from "./projector.js";

function images(size = 9) {
  return Array.from({ length: 10 }, (_, i) => {
    const bytes = Buffer.alloc(size);
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
    bytes[bytes.length - 1] = i;
    return { type: "image" as const, data: bytes.toString("base64"), mimeType: "image/png" };
  });
}

it("restores all ten upload references for transcript projection and navigation", () => {
  const content = images();
  const ids = content.map(() => `${randomUUID()}.png`);
  const history = new ImageHistory();
  const refs = history.remember(content, ids);
  const restored = new ImageHistory();
  restored.restore([{ type: "custom", customType: IMAGE_METADATA, data: refs }]);
  const message = { role: "user", content };
  expect(restored.ids(message)).toEqual(ids);
  expect(projectMessage(message, "images", restored.url)[0].attachments).toEqual(
    ids.map((id) => `/api/uploads/${id}`),
  );
});

it("hydrates all ten large history images while retaining the existing copy concurrency bound", async () => {
  const directory = await mkdtemp(join(tmpdir(), "fb-history-"));
  vi.stubEnv("FERNBLICK_UPLOAD_DIR", directory);
  try {
    const history = new ImageHistory();
    const message = { role: "user", content: images(129 * 1024) };
    const persist = vi.fn();
    expect(await history.hydrate(message, () => true, persist)).toBe(true);
    expect(persist).toHaveBeenCalledTimes(10);
    expect(history.ids(message)).toHaveLength(10);
    expect(projectMessage(message, "images", history.url)[0].attachments).toHaveLength(10);
  } finally {
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  }
});
