import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { imageTypes } from "../../packages/pi-live-chat/images.js";
import { MAX_IMAGE_BYTES } from "../../packages/pi-live-chat/protocol.js";
import { isLocalImagePath } from "../../src/shared/localImages.js";

export class LocalImageError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const unsupported = () => new LocalImageError(415, "Local image must be PNG, JPEG, GIF or WebP");

// Read the original on every request. No uploads, copies, path registry or cache.
// Symlinks and all readable directories are allowed for this private VPS app.
export async function readLocalImage(path: string) {
  if (!isLocalImagePath(path)) throw new LocalImageError(400, "An absolute image path is required");
  try {
    // Nonblocking open prevents a named pipe from hanging before the file check.
    const file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
    try {
      const before = await file.stat();
      if (!before.isFile() || before.size === 0) throw unsupported();
      if (before.size > MAX_IMAGE_BYTES)
        throw new LocalImageError(413, "Local image exceeds 10 MiB");
      // Bound the allocation/read even if a different process grows the file.
      const buffer = Buffer.alloc(before.size + 1);
      let size = 0;
      while (size < buffer.length) {
        const { bytesRead } = await file.read(buffer, size, buffer.length - size, size);
        if (!bytesRead) break;
        size += bytesRead;
      }
      const after = await file.stat();
      if (
        size !== before.size ||
        after.size !== before.size ||
        after.mtimeMs !== before.mtimeMs ||
        after.ctimeMs !== before.ctimeMs
      )
        throw new LocalImageError(409, "Local image changed while reading; try again");
      const bytes = buffer.subarray(0, size);
      const mimeType = Object.entries(imageTypes).find(([, type]) => type.matches(bytes))?.[0];
      if (!mimeType) throw unsupported();
      return { bytes, mimeType };
    } finally {
      await file.close();
    }
  } catch (error) {
    if (error instanceof LocalImageError) throw error;
    // Do not expose OS errors or unrelated file contents to the browser.
    throw new LocalImageError(404, "Local image unavailable");
  }
}
