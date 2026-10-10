import { constants } from "node:fs";
import { open, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { privateDirectory } from "./security.js";
import { MAX_IMAGE_BYTES, uploadIdSchema } from "./protocol.js";

export const imageTypes = {
  "image/png": {
    extension: "png",
    matches: (b: Buffer) => b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
  },
  "image/jpeg": {
    extension: "jpg",
    matches: (b: Buffer) => b[0] === 255 && b[1] === 216 && b.at(-2) === 255 && b.at(-1) === 217,
  },
  "image/gif": {
    extension: "gif",
    matches: (b: Buffer) => ["GIF87a", "GIF89a"].includes(b.subarray(0, 6).toString("ascii")),
  },
  "image/webp": {
    extension: "webp",
    matches: (b: Buffer) =>
      b.subarray(0, 4).toString("ascii") === "RIFF" &&
      b.subarray(8, 12).toString("ascii") === "WEBP",
  },
} as const;
export type ImageMimeType = keyof typeof imageTypes;
export function uploadDirectory() {
  return process.env.FERNBLICK_UPLOAD_DIR ?? "/tmp/fernblick";
}
export function imageUploadPath(id: string) {
  return join(uploadDirectory(), uploadIdSchema.parse(id));
}
export function mimeTypeForUpload(id: string): ImageMimeType {
  uploadIdSchema.parse(id);
  if (id.endsWith(".png")) return "image/png";
  if (id.endsWith(".jpg")) return "image/jpeg";
  if (id.endsWith(".gif")) return "image/gif";
  return "image/webp";
}
export function validateImage(bytes: Buffer, mimeType: string) {
  const type = imageTypes[mimeType as ImageMimeType];
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES || !type?.matches(bytes))
    throw new Error("Image must be PNG, JPEG, GIF or WebP, at most 10 MiB, with matching content");
  return type;
}
export async function saveImageUpload(bytes: Buffer, mimeType: string) {
  const type = validateImage(bytes, mimeType);
  await privateDirectory(join(uploadDirectory(), "guard"), true);
  const id = `${randomUUID()}.${type.extension}`;
  const path = imageUploadPath(id);
  await writeFile(path, bytes, { flag: "wx", mode: 0o600 });
  return { id, path, url: `/api/uploads/${id}` };
}
export async function readImageUpload(id: string) {
  const path = imageUploadPath(id);
  await privateDirectory(join(uploadDirectory(), "guard"));
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await file.stat();
    if (
      !before.isFile() ||
      before.uid !== process.getuid?.() ||
      (before.mode & 0o077) !== 0 ||
      before.nlink !== 1 ||
      before.size < 1 ||
      before.size > MAX_IMAGE_BYTES
    )
      throw new Error("Unsafe or oversized image upload");
    // Bounded even if another same-user process grows the file during the read.
    const buffer = Buffer.alloc(before.size + 1);
    let size = 0;
    while (size < buffer.length) {
      const { bytesRead } = await file.read(buffer, size, buffer.length - size, size);
      if (!bytesRead) break;
      size += bytesRead;
    }
    const after = await file.stat();
    if (size !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs)
      throw new Error("Image changed while reading");
    const bytes = buffer.subarray(0, size);
    validateImage(bytes, mimeTypeForUpload(id));
    return bytes;
  } finally {
    await file.close();
  }
}
export async function prepareImages(ids: string[]) {
  const images: { type: "image"; data: string; mimeType: string }[] = [];
  // Sequential reads limit temporary binary buffers; the protocol bounds retained images.
  for (const id of ids)
    images.push({
      type: "image",
      data: (await readImageUpload(id)).toString("base64"),
      mimeType: mimeTypeForUpload(id),
    });
  return images;
}
