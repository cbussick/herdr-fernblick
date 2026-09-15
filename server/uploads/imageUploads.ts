import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const uploadDirectory = join(tmpdir(), "fernblick");
const imageTypes = {
  "image/png": {
    extension: "png",
    matches: (b: Buffer) => b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
  },
  "image/jpeg": {
    extension: "jpg",
    matches: (b: Buffer) =>
      b[0] === 0xff && b[1] === 0xd8 && b.at(-2) === 0xff && b.at(-1) === 0xd9,
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
export const uploadIdPattern = /^[0-9a-f-]{36}\.(?:png|jpg|gif|webp)$/;

export async function saveImageUpload(bytes: Buffer, mimeType: string) {
  const type = imageTypes[mimeType as ImageMimeType];
  if (!type || !type.matches(bytes)) throw new Error("The uploaded file is not a supported image");
  await mkdir(uploadDirectory, { recursive: true, mode: 0o700 });
  const id = `${randomUUID()}.${type.extension}`;
  const path = join(uploadDirectory, id);
  await writeFile(path, bytes, { mode: 0o600, flag: "wx" });
  return { id, path, url: `/api/uploads/${id}` };
}

export function getImageUploadPath(id: string) {
  if (!uploadIdPattern.test(id)) throw new Error("Invalid image attachment");
  return join(uploadDirectory, id);
}

export async function readImageUpload(id: string) {
  return readFile(getImageUploadPath(id));
}

export function mimeTypeForUpload(id: string) {
  if (id.endsWith(".png")) return "image/png";
  if (id.endsWith(".jpg")) return "image/jpeg";
  if (id.endsWith(".gif")) return "image/gif";
  return "image/webp";
}
