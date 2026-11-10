import {
  MAX_BOARD_BYTES,
  boardSceneSchema,
  boardOperationSchema,
  type BoardOperation,
  type BoardScene,
} from "../../packages/pi-live-chat/boardProtocol.js";
import { BoardError, requireBoard } from "./errors.js";
import { validateFlowGraph, type FlowElement } from "../../packages/pi-live-chat/flowProtocol.js";
import { applyFlowOperations, flowSummary } from "./flowScene.js";
import { validateRasterBudget } from "./rasterBudget.js";

export const emptyScene = (): BoardScene => ({
  engine: "react-flow",
  elements: [],
  files: {},
  background: "#ffffff",
});
const pngMagic = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export function validatePng(bytes: Buffer): void {
  requireBoard(
    Buffer.isBuffer(bytes) && bytes.length >= 8 && bytes.length <= MAX_BOARD_BYTES,
    400,
    "PNG must be nonempty and at most 12 MiB",
  );
  requireBoard(bytes.subarray(0, 8).equals(pngMagic), 400, "Invalid PNG signature");
}

function inspect(value: unknown, depth = 0): void {
  requireBoard(depth <= 40, 400, "Board data is too deeply nested");
  if (typeof value === "number")
    requireBoard(Number.isFinite(value), 400, "Board numbers must be finite");
  if (!value || typeof value !== "object") return;
  requireBoard(
    Array.isArray(value) ||
      Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null,
    400,
    "Board values must be plain JSON data",
  );
  for (const [key, child] of Object.entries(value)) {
    requireBoard(
      !["__proto__", "prototype", "constructor"].includes(key),
      400,
      "Unsafe board property",
    );
    inspect(child, depth + 1);
  }
}

export function validateScene(input: unknown): BoardScene {
  let encoded: string;
  try {
    inspect(input);
    encoded = JSON.stringify(input);
  } catch (error) {
    if (error instanceof BoardError) throw error;
    throw new BoardError(400, "Board must be JSON data");
  }
  requireBoard(
    typeof encoded === "string" && Buffer.byteLength(encoded) <= MAX_BOARD_BYTES,
    413,
    "Board exceeds 12 MiB",
  );
  // Parse a detached value: callers cannot mutate a scene while a write awaits I/O.
  const parsed = boardSceneSchema.safeParse(JSON.parse(encoded));
  requireBoard(parsed.success, 400, "Invalid board scene");
  const scene = parsed.data;
  try {
    scene.elements = validateFlowGraph(scene);
  } catch {
    throw new BoardError(400, "Invalid flow graph");
  }
  for (const [id, file] of Object.entries(scene.files)) {
    requireBoard(id === file.id, 400, "Asset key must match its ID");
    const prefix = `data:${file.mimeType};base64,`;
    requireBoard(file.dataURL.startsWith(prefix), 400, "Asset MIME type mismatch");
    const encodedImage = file.dataURL.slice(prefix.length);
    const bytes = Buffer.from(encodedImage, "base64");
    requireBoard(bytes.toString("base64") === encodedImage, 400, "Invalid asset base64");
    const valid =
      file.mimeType === "image/png"
        ? bytes.subarray(0, 8).equals(pngMagic)
        : file.mimeType === "image/jpeg"
          ? bytes[0] === 255 && bytes[1] === 216 && bytes.at(-2) === 255 && bytes.at(-1) === 217
          : file.mimeType === "image/gif"
            ? ["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString("ascii"))
            : bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
              bytes.subarray(8, 12).toString("ascii") === "WEBP";
    requireBoard(valid, 400, "Asset does not match its raster image type");
  }
  try {
    validateRasterBudget(scene);
  } catch {
    throw new BoardError(400, "Flow raster assets exceed the pre-decode dimension/pixel limit");
  }
  return scene;
}

export function applyOperations(scene: BoardScene, operations: BoardOperation[]): BoardScene {
  return validateScene(
    applyFlowOperations(
      validateScene(scene),
      operations.map((op) => boardOperationSchema.parse(op)),
    ),
  );
}

export function summarize(scene: BoardScene, revision: number, offset = 0, limit = 100) {
  const live = scene.elements.filter((e) => !e.isDeleted);
  const elements: Record<string, unknown>[] = [];
  let bytes = 0;
  for (const e of live.slice(offset, offset + limit)) {
    const summary = flowSummary(e as FlowElement, scene.files);
    const size = Buffer.byteLength(JSON.stringify(summary));
    if (bytes + size > 128 * 1024) break;
    bytes += size;
    elements.push(summary);
  }
  return {
    engine: scene.engine,
    revision,
    total: live.length,
    offset,
    nextOffset: offset + elements.length < live.length ? offset + elements.length : null,
    elements,
  };
}
