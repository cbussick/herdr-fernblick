import { expect, it } from "vitest";
import type { BoardScene } from "../../packages/pi-live-chat/boardProtocol.js";
import { validateRasterBudget } from "./rasterBudget.js";

function png(width: number, height: number) {
  const bytes = Buffer.alloc(33);
  bytes.write("IHDR", 12);
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}
function gif(width: number, height: number) {
  const bytes = Buffer.alloc(10);
  bytes.write("GIF89a");
  bytes.writeUInt16LE(width, 6);
  bytes.writeUInt16LE(height, 8);
  return bytes;
}
function jpeg(width: number, height: number) {
  const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xc2, 0, 8, 8, 0, 0, 0, 0, 1, 0xff, 0xd9]);
  bytes.writeUInt16BE(height, 7);
  bytes.writeUInt16BE(width, 9);
  return bytes;
}
function webp(width: number, height: number, kind: "VP8X" | "VP8L" | "VP8 ") {
  const size = kind === "VP8L" ? 5 : 10;
  const bytes = Buffer.alloc(20 + size + (size & 1));
  bytes.write("RIFF");
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write("WEBP", 8);
  bytes.write(kind, 12);
  bytes.writeUInt32LE(size, 16);
  if (kind === "VP8X") {
    bytes.writeUIntLE(width - 1, 24, 3);
    bytes.writeUIntLE(height - 1, 27, 3);
  } else if (kind === "VP8L") {
    const w = width - 1,
      h = height - 1;
    bytes[20] = 0x2f;
    bytes[21] = w & 255;
    bytes[22] = ((w >> 8) & 0x3f) | ((h & 3) << 6);
    bytes[23] = (h >> 2) & 255;
    bytes[24] = (h >> 10) & 15;
  } else {
    Buffer.from([0x9d, 1, 0x2a]).copy(bytes, 23);
    bytes.writeUInt16LE(width, 26);
    bytes.writeUInt16LE(height, 28);
  }
  return bytes;
}
function scene(bytes: Buffer, mimeType: BoardScene["files"][string]["mimeType"]): BoardScene {
  return {
    elements: [{ id: "image", type: "image", x: 0, y: 0, width: 10, height: 10, fileId: "asset" }],
    files: {
      asset: {
        id: "asset",
        mimeType,
        dataURL: `data:${mimeType};base64,${bytes.toString("base64")}`,
        created: 0,
      },
    },
    background: "#ffffff",
  };
}
it.each([
  ["PNG", "image/png", png],
  ["GIF", "image/gif", gif],
  ["JPEG", "image/jpeg", jpeg],
  ["WebP extended", "image/webp", (w: number, h: number) => webp(w, h, "VP8X")],
  ["WebP lossless", "image/webp", (w: number, h: number) => webp(w, h, "VP8L")],
  ["WebP lossy", "image/webp", (w: number, h: number) => webp(w, h, "VP8 ")],
] as const)("preflights %s container dimensions without decoding", (_name, mime, bytes) => {
  expect(() => validateRasterBudget(scene(bytes(200, 100), mime))).not.toThrow();
  expect(() => validateRasterBudget(scene(bytes(8000, 8000), mime))).toThrow("pre-decode");
});
it("rejects zero dimensions, excessive sides and truncated headers", () => {
  for (const bytes of [png(0, 2), png(1, 33000), Buffer.alloc(8)])
    expect(() => validateRasterBudget(scene(bytes, "image/png"))).toThrow();
  expect(() =>
    validateRasterBudget(scene(Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0xff, 0xff]), "image/jpeg")),
  ).toThrow();
});
it("budgets unique referenced assets cumulatively and ignores deleted/unused assets", () => {
  const value = scene(png(6000, 4000), "image/png");
  value.elements.push({ ...value.elements[0], id: "copy" });
  expect(() => validateRasterBudget(value)).not.toThrow();
  value.files.other = { ...value.files.asset, id: "other" };
  value.elements.push({ ...value.elements[0], id: "other-image", fileId: "other" });
  expect(() => validateRasterBudget(value)).toThrow("pre-decode");
  value.elements.at(-1)!.isDeleted = true;
  expect(() => validateRasterBudget(value)).not.toThrow();
});
