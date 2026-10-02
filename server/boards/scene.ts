import { randomInt } from "node:crypto";
import {
  MAX_BOARD_BYTES,
  boardSceneSchema,
  type BoardElement,
  type BoardOperation,
  type BoardScene,
} from "../../packages/pi-live-chat/boardProtocol.js";
import { BoardError, requireBoard } from "./errors.js";

export const emptyScene = (): BoardScene => ({ elements: [], files: {}, background: "#ffffff" });
const nonce = () => randomInt(1, 0x7fffffff);
const pngMagic = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export function validatePng(bytes: Buffer): void {
  requireBoard(
    Buffer.isBuffer(bytes) && bytes.length >= 8 && bytes.length <= MAX_BOARD_BYTES,
    400,
    "PNG must be nonempty and at most 12 MiB",
  );
  requireBoard(bytes.subarray(0, 8).equals(pngMagic), 400, "Invalid PNG signature");
}

// Restrict depth before schema recursion, reject object keys that are dangerous to
// downstream consumers, and never accept alternate asset/link channels on shapes.
function inspect(value: unknown, depth = 0, element = false): void {
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
    if (element && /(?:url|href|src|link)$/i.test(key)) {
      let safeLink = false;
      if (key === "link" && typeof child === "string") {
        try {
          const url = new URL(child);
          safeLink =
            /^https?:\/\//i.test(child) &&
            ["http:", "https:"].includes(url.protocol) &&
            !url.username &&
            !url.password;
        } catch {
          /* Only explicit, ordinary web links are accepted. */
        }
      }
      requireBoard(
        child === null || child === "" || safeLink,
        400,
        "Unsafe shape URL or inline asset",
      );
    }
    if (
      element &&
      typeof child === "string" &&
      key !== "text" &&
      key !== "originalText" &&
      key !== "link"
    ) {
      requireBoard(
        !/^\s*(?:data:|javascript:|vbscript:|file:|https?:\/\/|url\s*\()/i.test(child),
        400,
        "Unsafe shape URL or inline asset",
      );
    }
    inspect(child, depth + 1, element);
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
  const ids = new Set<string>();
  for (const element of scene.elements) {
    requireBoard(!ids.has(element.id), 400, "Duplicate shape ID");
    ids.add(element.id);
    inspect(element, 0, true);
    if (element.type === "image" && !element.isDeleted && element.fileId != null) {
      requireBoard(
        typeof element.fileId === "string" && Object.hasOwn(scene.files, element.fileId),
        400,
        "Image refers to a missing asset",
      );
    }
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
  return scene;
}

function isReference(value: unknown, id: string): boolean {
  return !!value && typeof value === "object" && "elementId" in value && value.elementId === id;
}
function editable(element: BoardElement, elements: BoardElement[]): void {
  requireBoard(
    ["rectangle", "text", "arrow"].includes(element.type),
    400,
    "Unsupported shape type for agent editing",
  );
  requireBoard(
    !element.locked &&
      element.frameId == null &&
      element.containerId == null &&
      element.startBinding == null &&
      element.endBinding == null &&
      !element.elbowed &&
      (element.groupIds == null ||
        (Array.isArray(element.groupIds) && element.groupIds.length === 0)) &&
      (element.boundElements == null ||
        (Array.isArray(element.boundElements) && element.boundElements.length === 0)),
    400,
    "Cannot edit locked, grouped, framed, or bound shapes",
  );
  for (const other of elements) {
    if (other.isDeleted || other.id === element.id) continue;
    requireBoard(
      other.frameId !== element.id &&
        other.containerId !== element.id &&
        !isReference(other.startBinding, element.id) &&
        !isReference(other.endBinding, element.id) &&
        !(
          Array.isArray(other.boundElements) &&
          other.boundElements.some(
            (v) => !!v && typeof v === "object" && "id" in v && v.id === element.id,
          )
        ),
      400,
      "Cannot edit a shape referenced by another shape",
    );
  }
  if (element.type === "arrow") {
    const points = element.points;
    requireBoard(
      !element.angle &&
        Array.isArray(points) &&
        points.length === 2 &&
        points.every(
          (p) =>
            Array.isArray(p) &&
            p.length === 2 &&
            p.every((n) => typeof n === "number" && Number.isFinite(n)),
        ) &&
        Array.isArray(points[0]) &&
        points[0][0] === 0 &&
        points[0][1] === 0,
      400,
      "Only unrotated two-point arrows can be edited",
    );
  }
}

function textSize(element: BoardElement): void {
  const text = typeof element.text === "string" ? element.text : "";
  const size = typeof element.fontSize === "number" ? element.fontSize : 20;
  const lineHeight = typeof element.lineHeight === "number" ? element.lineHeight : 1.25;
  requireBoard(
    text.length <= 4000 && size > 0 && size <= 1000 && lineHeight > 0 && lineHeight <= 10,
    400,
    "Text is too large or has unsupported font metrics",
  );
  const lines = text.split("\n");
  // A deliberately conservative, DOM-free estimate, including wide Unicode glyphs.
  element.width = Math.max(
    size,
    ...lines.map((line) => Array.from(line).reduce((n, c) => n + (c === "\t" ? 4 : 1), 0) * size),
  );
  element.height = Math.max(1, lines.length) * size * lineHeight;
  element.originalText = text;
  element.autoResize = true;
}

function fields(element: BoardElement, op: Exclude<BoardOperation, { op: "delete" }>): void {
  if (element.type !== "text")
    requireBoard(
      op.text === undefined && op.fontSize === undefined,
      400,
      "Text fields require a text shape",
    );
  if (element.type !== "arrow")
    requireBoard(op.endX === undefined && op.endY === undefined, 400, "Endpoints require an arrow");
  if (element.type === "text")
    requireBoard(
      op.width === undefined && op.height === undefined,
      400,
      "Text dimensions are computed automatically",
    );
  if (element.type === "arrow")
    requireBoard(
      op.width === undefined && op.height === undefined,
      400,
      "Arrow dimensions are computed from endpoints",
    );
  if (op.x !== undefined) element.x = op.x;
  if (op.y !== undefined) element.y = op.y;
  if (op.width !== undefined) element.width = op.width;
  if (op.height !== undefined) element.height = op.height;
  if (op.color !== undefined) element.strokeColor = op.color;
  if (op.background !== undefined) element.backgroundColor = op.background;
  if (op.fontSize !== undefined) element.fontSize = op.fontSize;
  if (op.text !== undefined) element.text = op.text;
  if (element.type === "text" && (op.text !== undefined || op.fontSize !== undefined)) {
    if (op.text === undefined && typeof element.originalText === "string")
      element.text = element.originalText;
    textSize(element);
  }
  if (element.type === "arrow") {
    requireBoard(
      (op.endX === undefined) === (op.endY === undefined),
      400,
      "Arrow requires both endpoint coordinates",
    );
    if (op.endX !== undefined && op.endY !== undefined) {
      const dx = op.endX - element.x;
      const dy = op.endY - element.y;
      element.points = [
        [0, 0],
        [dx, dy],
      ];
      element.width = Math.abs(dx);
      element.height = Math.abs(dy);
    }
  }
}

function create(op: Extract<BoardOperation, { op: "create" }>): BoardElement {
  const element: BoardElement = {
    id: op.id,
    type: op.kind,
    x: op.x,
    y: op.y,
    width: 100,
    height: 60,
    angle: 0,
    strokeColor: "#1e1e1e",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 2,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: null,
    seed: nonce(),
    version: 1,
    versionNonce: nonce(),
    isDeleted: false,
    boundElements: null,
    updated: Date.now(),
    link: null,
    locked: false,
    index: null,
  };
  if (op.kind === "text") {
    requireBoard(op.text !== undefined, 400, "Text creation requires text");
    Object.assign(element, {
      text: op.text,
      originalText: op.text,
      fontSize: 20,
      fontFamily: 1,
      textAlign: "left",
      verticalAlign: "top",
      containerId: null,
      autoResize: true,
      lineHeight: 1.25,
    });
  }
  if (op.kind === "arrow") {
    requireBoard(
      op.endX !== undefined && op.endY !== undefined,
      400,
      "Arrow creation requires endpoints",
    );
    Object.assign(element, {
      points: [
        [0, 0],
        [0, 0],
      ],
      startBinding: null,
      endBinding: null,
      startArrowhead: null,
      endArrowhead: "arrow",
      elbowed: false,
      lastCommittedPoint: null,
    });
  }
  fields(element, op);
  return element;
}

export function applyOperations(scene: BoardScene, operations: BoardOperation[]): BoardScene {
  const next = structuredClone(scene);
  const touched = new Set<string>();
  for (const op of operations) {
    requireBoard(!touched.has(op.id), 400, "A shape may only be targeted once per operation batch");
    touched.add(op.id);
    const element = next.elements.find((e) => e.id === op.id);
    if (op.op === "create") {
      requireBoard(!element, 409, "Shape ID already exists (including deleted shapes)");
      next.elements.push(create(op));
    } else {
      requireBoard(element && !element.isDeleted, 404, "Shape does not exist");
      editable(element, scene.elements);
      if (op.op === "delete") element.isDeleted = true;
      else fields(element, op);
      requireBoard(
        element.version === undefined ||
          (typeof element.version === "number" &&
            Number.isSafeInteger(element.version) &&
            element.version >= 0 &&
            element.version < Number.MAX_SAFE_INTEGER),
        400,
        "Invalid shape version",
      );
      element.version = (typeof element.version === "number" ? element.version : 0) + 1;
      let nextNonce = nonce();
      while (nextNonce === element.versionNonce) nextNonce = nonce();
      element.versionNonce = nextNonce;
      element.updated = Date.now();
    }
  }
  return validateScene(next);
}

export function summarize(scene: BoardScene, revision: number, offset = 0, limit = 100) {
  const live = scene.elements.filter((e) => !e.isDeleted);
  const elements: Record<string, unknown>[] = [];
  let bytes = 0;
  for (const e of live.slice(offset, offset + limit)) {
    const summary: Record<string, unknown> = {
      id: e.id,
      type: e.type,
      x: e.x,
      y: e.y,
      width: e.width,
      height: e.height,
    };
    if (e.type === "text" && typeof e.text === "string") {
      summary.text = e.text.slice(0, 4000);
      if (e.text.length > 4000) summary.textTruncated = true;
    }
    // Do not leak freehand paths, bindings, custom data, or image assets.
    if (e.type === "arrow" && Array.isArray(e.points)) {
      summary.points = e.points
        .slice(0, 100)
        .map((p) =>
          Array.isArray(p)
            ? p.slice(0, 2).map((n) => (typeof n === "number" && Number.isFinite(n) ? n : 0))
            : [0, 0],
        );
      if (e.points.length > 100) summary.pointsTruncated = true;
    }
    const size = Buffer.byteLength(JSON.stringify(summary));
    if (elements.length && bytes + size > 128 * 1024) break;
    bytes += size;
    elements.push(summary);
  }
  return {
    revision,
    total: live.length,
    offset,
    nextOffset: offset + elements.length < live.length ? offset + elements.length : null,
    elements,
  };
}
