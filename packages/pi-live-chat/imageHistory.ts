import { createHash } from "node:crypto";
import { z } from "zod";
import { imageUrl } from "./projector.js";
import { MAX_IMAGE_BYTES, uploadIdSchema } from "./protocol.js";
import { saveImageUpload, validateImage } from "./images.js";

export const IMAGE_METADATA = "fernblick-image-uploads";
const referenceSchema = z.object({ hash: z.string().regex(/^[a-f0-9]{64}$/), id: uploadIdSchema });
type Reference = z.infer<typeof referenceSchema>;
function image(value: unknown) {
  if (!value || typeof value !== "object") return;
  const b = value as { type?: string; data?: string; mimeType?: string };
  if (
    b.type !== "image" ||
    typeof b.data !== "string" ||
    typeof b.mimeType !== "string" ||
    b.data.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4
  )
    return;
  return { type: "image" as const, data: b.data, mimeType: b.mimeType };
}
function fingerprint(b: { data: string; mimeType: string }) {
  return createHash("sha256").update(b.mimeType).update("\0").update(b.data).digest("hex");
}
// This is image reference metadata, not message delivery state or a queue.
export class ImageHistory {
  private references = new Map<string, string>();
  private pending = new Set<string>();
  private set(ref: Reference) {
    this.references.set(ref.hash, ref.id);
    while (this.references.size > 4096)
      this.references.delete(this.references.keys().next().value!);
  }
  restore(entries: readonly unknown[]) {
    for (const raw of entries) {
      const e = raw as { type?: string; customType?: string; data?: unknown };
      if (e.type !== "custom" || e.customType !== IMAGE_METADATA) continue;
      const parsed = z.array(referenceSchema).max(4).safeParse(e.data);
      if (parsed.success) for (const ref of parsed.data) this.set(ref);
    }
  }
  remember(images: { data: string; mimeType: string }[], ids: string[]) {
    const refs = images.map((b, i) => ({ hash: fingerprint(b), id: uploadIdSchema.parse(ids[i]) }));
    for (const ref of refs) this.set(ref);
    return refs;
  }
  url = (value: unknown): string | undefined => {
    const b = image(value);
    const id = b && this.references.get(fingerprint(b));
    return id ? `/api/uploads/${id}` : imageUrl(value);
  };
  ids(message: unknown) {
    const content = (message as { content?: unknown })?.content;
    if (!Array.isArray(content)) return [];
    return content
      .flatMap((value) => {
        const url = this.url(value);
        return url?.startsWith("/api/uploads/") ? [url.slice("/api/uploads/".length)] : [];
      })
      .slice(0, 4);
  }
  async hydrate(message: unknown, valid: () => boolean, persist: (refs: Reference[]) => void) {
    const content = (message as { content?: unknown })?.content;
    if (!Array.isArray(content)) return false;
    let changed = false;
    for (const value of content.filter((b) => b?.type === "image").slice(0, 4)) {
      const b = image(value);
      if (!b || !valid()) continue;
      const hash = fingerprint(b);
      if (
        this.references.has(hash) ||
        imageUrl(b) ||
        this.pending.has(hash) ||
        this.pending.size >= 4
      )
        continue;
      this.pending.add(hash);
      try {
        // Large/normalized history images are served via HTTP, never large socket frames.
        if (!/^[A-Za-z0-9+/]*={0,2}$/.test(b.data)) continue;
        const bytes = Buffer.from(b.data, "base64");
        validateImage(bytes, b.mimeType);
        const upload = await saveImageUpload(bytes, b.mimeType);
        if (!valid()) return false;
        const ref = { hash, id: upload.id };
        this.set(ref);
        persist([ref]);
        changed = true;
      } catch {
        /* Missing/insecure uploads remain visibly unavailable; no effect on Pi. */
      } finally {
        this.pending.delete(hash);
      }
    }
    return changed;
  }
}
