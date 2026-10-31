import {
  boardSceneSchema,
  MAX_BOARD_BYTES,
  type BoardScene,
} from "../../../packages/pi-live-chat/boardProtocol";
import { validateFlowGraph, type FlowElement } from "../../../packages/pi-live-chat/flowProtocol";
import { edgeOptions, makeId, type Diagram } from "./model";
import { isInk } from "./ink";

export function validateScene(input: unknown): BoardScene {
  const json = JSON.stringify(input);
  if (new TextEncoder().encode(json).length > MAX_BOARD_BYTES)
    throw new Error("Board exceeds 12 MiB");
  const scene = boardSceneSchema.parse(JSON.parse(json));
  if (scene.engine !== "react-flow") throw new Error("Expected a React Flow board");
  scene.elements = validateFlowGraph(scene);
  for (const [id, file] of Object.entries(scene.files)) {
    const match = /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/]*={0,2})$/.exec(
      file.dataURL,
    );
    if (
      !/^[A-Za-z0-9_-]{1,128}$/.test(id) ||
      file.id !== id ||
      !match ||
      match[1] !== file.mimeType ||
      match[2]!.length % 4 !== 0 ||
      atob(match[2]!).length > 2 * 1024 * 1024
    )
      throw new Error("Invalid image asset (maximum 2 MiB)");
    const bytes = atob(match[2]!);
    const signatures: Record<string, boolean> = {
      "image/png": bytes.startsWith("\x89PNG\r\n\x1a\n"),
      "image/jpeg": bytes.startsWith("\xff\xd8\xff"),
      "image/gif": bytes.startsWith("GIF87a") || bytes.startsWith("GIF89a"),
      "image/webp": bytes.startsWith("RIFF") && bytes.slice(8, 12) === "WEBP",
    };
    if (!signatures[file.mimeType]) throw new Error("Image bytes do not match raster MIME type");
  }
  return scene;
}
export async function verifySceneImages(scene: BoardScene): Promise<void> {
  await Promise.all(
    Object.values(scene.files).map(async (file) => {
      const image = new Image();
      image.src = file.dataURL;
      try {
        await image.decode();
      } catch {
        throw new Error("Import contains a broken image");
      }
      if (!image.naturalWidth || !image.naturalHeight)
        throw new Error("Import contains an empty image");
    }),
  );
}
export function toDiagram(input: BoardScene): Diagram {
  const scene = validateScene(input),
    elements = validateFlowGraph(scene).filter((e) => !e.isDeleted);
  return {
    nodes: elements
      .filter((e) => e.type !== "connection")
      .sort(
        (a, b) =>
          Number(b.type === "component" && b.kind === "boundary") -
          Number(a.type === "component" && a.kind === "boundary"),
      )
      .map((e) => {
        const common = {
          id: e.id,
          position: { x: e.x, y: e.y },
          width: e.width,
          ...(e.type === "ink" || e.type === "primitive" || e.kind === "boundary"
            ? { height: e.height }
            : {}),
          style: {
            width: e.width,
            ...(e.type === "ink" || e.type === "primitive" || e.kind === "boundary"
              ? { height: e.height }
              : { minHeight: e.height }),
          },
        };
        if (e.type === "primitive")
          return {
            ...common,
            type: "primitive" as const,
            connectable: false,
            data: { kind: "primitive" as const, shape: e.kind, drawing: e.props },
          };
        if (e.type === "ink")
          return {
            ...common,
            zIndex: 2000,
            connectable: false,
            type: "ink" as const,
            data: { ...e.props, kind: "ink" as const },
          };
        const { imageId, ...props } = e.props;
        return {
          ...common,
          type: "component" as const,
          data: { ...props, kind: e.kind, image: imageId ? scene.files[imageId]!.dataURL : "" },
          ...(e.parentId ? { parentId: e.parentId } : {}),
          ...(e.kind === "boundary" ? { zIndex: -1 } : {}),
        };
      }),
    edges: elements
      .filter((e) => e.type === "connection")
      .map((e) => ({
        ...edgeOptions,
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle,
        targetHandle: e.targetHandle,
        label: e.label,
        style: { stroke: e.color, strokeWidth: 1.6 },
        markerEnd: { ...edgeOptions.markerEnd, color: e.color },
      })),
  };
}
/** Only explicit persistent fields cross the boundary; native measurement/selection is ignored. */
export function fromDiagram(diagram: Diagram, base: BoardScene): BoardScene {
  const files = { ...base.files };
  const previous = new Map(validateFlowGraph(base).map((e) => [e.id, e]));
  const candidates: FlowElement[] = [];
  for (const n of diagram.nodes) {
    const old = previous.get(n.id);
    const common = {
      id: n.id,
      x: n.position.x,
      y: n.position.y,
      width: n.width ?? Number(n.style?.width ?? 300),
      height: n.height ?? Number(n.style?.height ?? old?.height ?? 180),
      version: 1,
    };
    if (n.type === "primitive") {
      candidates.push({ ...common, type: "primitive", kind: n.data.shape, props: n.data.drawing });
    } else if (isInk(n)) {
      const { kind: _kind, ...props } = n.data;
      candidates.push({ ...common, type: "ink", props });
    } else {
      const { kind, image, ...props } = n.data;
      let imageId: string | null = null;
      if (image) {
        imageId = Object.keys(files).find((id) => files[id]!.dataURL === image) ?? makeId();
        if (!files[imageId])
          files[imageId] = {
            id: imageId,
            mimeType: image.slice(5, image.indexOf(";")) as BoardScene["files"][string]["mimeType"],
            dataURL: image,
            created: Date.now(),
          };
      }
      candidates.push({
        ...common,
        type: "component",
        kind,
        parentId: n.parentId ?? null,
        props: { ...props, imageId },
      });
    }
  }
  const liveNodes = new Set(candidates.map((e) => e.id));
  // Deleting a boundary can detach children; deleting a node must remove its edges.
  for (const e of candidates)
    if (e.type === "component" && e.parentId && !liveNodes.has(e.parentId)) e.parentId = null;
  for (const e of diagram.edges)
    if (liveNodes.has(e.source) && liveNodes.has(e.target))
      candidates.push({
        id: e.id,
        type: "connection",
        x: 0,
        y: 0,
        width: 1,
        height: 1,
        version: 1,
        source: e.source,
        target: e.target,
        sourceHandle: (e.sourceHandle || "right") as "right",
        targetHandle: (e.targetHandle || "left") as "left",
        label: String(e.label ?? ""),
        color: String(e.style?.stroke || "#8290a3"),
      });
  const next = candidates.map((e) => {
    const old = previous.get(e.id);
    if (!old) return e;
    const comparable = {
      ...e,
      version: old.version,
      ...(old.isDeleted === false ? { isDeleted: false } : {}),
    };
    return JSON.stringify(comparable) === JSON.stringify(old) || equalRecord(comparable, old)
      ? old
      : { ...e, version: old.version + 1 };
  });
  const ids = new Set(next.map((e) => e.id));
  for (const old of previous.values())
    if (!ids.has(old.id))
      next.push(old.isDeleted ? old : { ...old, isDeleted: true, version: old.version + 1 });
  return validateScene({
    engine: "react-flow",
    elements: next,
    files: liveFiles(next, files),
    background: base.background,
  });
}
function liveFiles(elements: FlowElement[], files: BoardScene["files"]): BoardScene["files"] {
  const used = new Set(
    elements.flatMap((e) =>
      e.type === "component" && !e.isDeleted && e.props.imageId ? [e.props.imageId] : [],
    ),
  );
  return Object.fromEntries(Object.entries(files).filter(([id]) => used.has(id)));
}
function equalRecord(a: FlowElement, b: FlowElement) {
  return JSON.stringify(sort(a)) === JSON.stringify(sort(b));
}
function sort(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sort);
  if (v && typeof v === "object")
    return Object.fromEntries(
      Object.entries(v)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, sort(v)]),
    );
  return v;
}
// The small wrapper allowance keeps a maximum-size scene's own backup importable.
export const MAX_FLOW_BACKUP_BYTES = MAX_BOARD_BYTES + 128;
export function exportFlowScene(scene: BoardScene): string {
  return JSON.stringify({ format: "fernblick-flow", version: 1, scene: validateScene(scene) });
}
export function importFlowScene(raw: string): BoardScene {
  if (new TextEncoder().encode(raw).length > MAX_FLOW_BACKUP_BYTES)
    throw new Error("Import exceeds 12 MiB");
  const data = JSON.parse(raw);
  if (
    data?.format !== "fernblick-flow" ||
    data.version !== 1 ||
    Object.keys(data).some((k) => !["format", "version", "scene"].includes(k))
  )
    throw new Error("Unsupported flow backup");
  return validateScene(data.scene);
}
/** Replacement gets fresh identities; old records remain tombstones in the controller's history. */
export function replacementScene(imported: BoardScene, base: BoardScene): BoardScene {
  const elements = validateFlowGraph(validateScene(imported));
  const ids = new Map(elements.map((e) => [e.id, makeId()]));
  // Recovery checkpoints own their assets. Tombstones need no image bytes, and
  // repeated clear/import must not exhaust the board's raster asset allowance.
  const files: BoardScene["files"] = {};
  const assetIds = new Map(
    Object.entries(imported.files).map(([id, file]) => {
      const fresh = makeId();
      files[fresh] = { ...file, id: fresh };
      return [id, fresh];
    }),
  );
  const fresh = elements
    .filter((e) => !e.isDeleted)
    .map((e): FlowElement => {
      const id = ids.get(e.id)!;
      if (e.type === "connection")
        return { ...e, id, version: 1, source: ids.get(e.source)!, target: ids.get(e.target)! };
      if (e.type === "component")
        return {
          ...e,
          id,
          version: 1,
          parentId: e.parentId ? ids.get(e.parentId)! : null,
          props: { ...e.props, imageId: e.props.imageId ? assetIds.get(e.props.imageId)! : null },
        };
      return { ...e, id, version: 1 };
    });
  return validateScene({
    ...imported,
    files: liveFiles(fresh, files),
    elements: [
      ...validateFlowGraph(base).map((e) =>
        e.isDeleted ? e : { ...e, isDeleted: true, version: e.version + 1 },
      ),
      ...fresh,
    ],
  });
}
