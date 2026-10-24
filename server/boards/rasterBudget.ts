import type { BoardScene } from "../../packages/pi-live-chat/boardProtocol.js";

const MAX_PIXELS = 32 * 1024 * 1024;
const MAX_SIDE = 32768;

/** Parse container dimensions without allocating decoded pixels. Not an image decoder. */
function dimensions(bytes: Buffer, mime: string): [number, number] {
  if (mime === "image/png" && bytes.length >= 24 && bytes.toString("ascii", 12, 16) === "IHDR")
    return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
  if (mime === "image/gif" && bytes.length >= 10)
    return [bytes.readUInt16LE(6), bytes.readUInt16LE(8)];
  if (mime === "image/jpeg") {
    let offset = 2;
    while (offset + 1 < bytes.length) {
      if (bytes[offset++] !== 0xff) break;
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (marker === 0xd9 || marker === 0xda || marker === undefined) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > bytes.length) break;
      const size = bytes.readUInt16BE(offset);
      if (size < 2 || offset + size > bytes.length) break;
      if (
        [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(
          marker,
        )
      ) {
        if (size < 8) break;
        return [bytes.readUInt16BE(offset + 5), bytes.readUInt16BE(offset + 3)];
      }
      offset += size;
    }
  }
  if (mime === "image/webp") {
    let offset = 12;
    while (offset + 8 <= bytes.length) {
      const kind = bytes.toString("ascii", offset, offset + 4);
      const size = bytes.readUInt32LE(offset + 4);
      const data = offset + 8;
      if (size > bytes.length - data) break;
      if (kind === "VP8X" && size >= 10)
        return [1 + bytes.readUIntLE(data + 4, 3), 1 + bytes.readUIntLE(data + 7, 3)];
      if (kind === "VP8L" && size >= 5 && bytes[data] === 0x2f)
        return [
          1 + bytes[data + 1] + ((bytes[data + 2] & 0x3f) << 8),
          1 + (bytes[data + 2] >> 6) + (bytes[data + 3] << 2) + ((bytes[data + 4] & 0xf) << 10),
        ];
      if (
        kind === "VP8 " &&
        size >= 10 &&
        bytes.subarray(data + 3, data + 6).equals(Buffer.from([0x9d, 0x01, 0x2a]))
      )
        return [bytes.readUInt16LE(data + 6) & 0x3fff, bytes.readUInt16LE(data + 8) & 0x3fff];
      offset = data + size + (size & 1);
    }
  }
  throw new Error("Board raster dimensions are invalid or unsupported");
}

export function validateRasterBudget(scene: BoardScene): void {
  const used = new Set(
    scene.elements.flatMap((element) =>
      element.type === "image" && !element.isDeleted && typeof element.fileId === "string"
        ? [element.fileId]
        : [],
    ),
  );
  let pixels = 0;
  for (const id of used) {
    const file = scene.files[id];
    if (!file) throw new Error("Missing board raster asset");
    const bytes = Buffer.from(file.dataURL.slice(file.dataURL.indexOf(",") + 1), "base64");
    const [width, height] = dimensions(bytes, file.mimeType);
    pixels += width * height;
    if (!width || !height || width > MAX_SIDE || height > MAX_SIDE || pixels > MAX_PIXELS)
      throw new Error("Board raster assets exceed the pre-decode dimension/pixel limit");
  }
}
