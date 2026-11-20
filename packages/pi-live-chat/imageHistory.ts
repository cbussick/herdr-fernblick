import { createHash } from "node:crypto";
import { z } from "zod";
import { imageUrl } from "./projector.js";
import { MAX_IMAGE_BYTES, MAX_IMAGES, uploadIdSchema } from "./protocol.js";
import { saveImageUpload, validateImage } from "./images.js";

export const IMAGE_METADATA = "fernblick-image-uploads";
const referenceSchema = z.object({ hash: z.string().regex(/^[a-f0-9]{64}$/), id: uploadIdSchema });
type Reference = z.infer<typeof referenceSchema>;
const historyImageSchema = z.object({
  type: z.literal("image"),
  data: z.string().max(Math.ceil(MAX_IMAGE_BYTES / 3) * 4),
  mimeType: z.string(),
});
const historyContentSchema = z.object({ content: z.array(z.unknown()) });
const metadataSchema = z.object({
  type: z.literal("custom"),
  customType: z.literal(IMAGE_METADATA),
  data: z.array(referenceSchema).max(MAX_IMAGES),
});
function image(value: unknown) {
  const parsed = historyImageSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
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
    while (this.references.size > 4096) {
      const oldest = this.references.keys().next();
      if (oldest.done) {
        break;
      }
      this.references.delete(oldest.value);
    }
  }
  restore(entries: ReadonlyArray<unknown>) {
    for (const raw of entries) {
      const parsed = metadataSchema.safeParse(raw);
      if (parsed.success) {
        for (const ref of parsed.data.data) {
          this.set(ref);
        }
      }
    }
  }
  remember(images: Array<{ data: string; mimeType: string }>, ids: Array<string>) {
    const refs = images.map((b, i) => ({ hash: fingerprint(b), id: uploadIdSchema.parse(ids[i]) }));
    for (const ref of refs) {
      this.set(ref);
    }
    return refs;
  }
  url = (value: unknown): string | undefined => {
    const b = image(value);
    const id = b && this.references.get(fingerprint(b));
    return id ? `/api/uploads/${id}` : imageUrl(value);
  };
  ids(message: unknown) {
    const parsed = historyContentSchema.safeParse(message);
    if (!parsed.success) {
      return [];
    }
    return parsed.data.content
      .flatMap((value) => {
        const url = this.url(value);
        return url?.startsWith("/api/uploads/") ? [url.slice("/api/uploads/".length)] : [];
      })
      .slice(0, MAX_IMAGES);
  }
  async hydrate(message: unknown, valid: () => boolean, persist: (refs: Array<Reference>) => void) {
    const parsed = historyContentSchema.safeParse(message);
    if (!parsed.success) {
      return false;
    }
    let changed = false;
    const candidates = parsed.data.content.filter(
      (block) =>
        block !== null && typeof block === "object" && "type" in block && block.type === "image",
    );
    for (const value of candidates.slice(0, MAX_IMAGES)) {
      const b = image(value);
      if (!b || !valid()) {
        continue;
      }
      const hash = fingerprint(b);
      if (
        this.references.has(hash) ||
        imageUrl(b) ||
        this.pending.has(hash) ||
        this.pending.size >= 4
      ) {
        continue;
      }
      this.pending.add(hash);
      try {
        // Large/normalized history images are served via HTTP, never large socket frames.
        if (!/^[A-Za-z0-9+/]*={0,2}$/.test(b.data)) {
          continue;
        }
        const bytes = Buffer.from(b.data, "base64");
        validateImage(bytes, b.mimeType);
        const upload = await saveImageUpload(bytes, b.mimeType);
        if (!valid()) {
          return false;
        }
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
