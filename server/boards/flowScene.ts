import type { BoardOperation, BoardScene } from "../../packages/pi-live-chat/boardProtocol.js";
import {
  defaultFlowProps,
  flowKinds,
  validateFlowGraph,
  type FlowElement,
  type FlowKind,
} from "../../packages/pi-live-chat/flowProtocol.js";
import { BoardError, requireBoard } from "./errors.js";

/** Relationships are implicit dependencies, including both sides of existing relations.
 * New endpoints must already have been read; same-batch creation is deliberately not supported.
 */
export function flowDependencies(scene: BoardScene, op: BoardOperation): string[] {
  if (scene.engine !== "react-flow") return [];
  const ids = new Set<string>();
  const relation = (e: Record<string, unknown>) => {
    for (const key of ["parentId", "source", "target"])
      if (typeof e[key] === "string") ids.add(e[key] as string);
  };
  if (op.op !== "delete") relation(op);
  for (const e of scene.elements) {
    if (e.isDeleted) continue;
    if (e.id === op.id) relation(e);
    if (e.parentId === op.id || e.source === op.id || e.target === op.id) {
      ids.add(e.id);
      relation(e);
    }
  }
  return [...ids];
}

export function applyFlowOperations(scene: BoardScene, operations: BoardOperation[]): BoardScene {
  let elements: FlowElement[];
  try {
    elements = validateFlowGraph(scene);
  } catch {
    throw new BoardError(400, "Invalid flow graph");
  }
  const touched = new Set<string>();
  for (const op of operations) {
    requireBoard(!touched.has(op.id), 400, "A shape may only be targeted once per operation batch");
    touched.add(op.id);
    let element = elements.find((e) => e.id === op.id);
    if (op.op === "create") {
      requireBoard(!element, 409, "Shape ID already exists (including deleted shapes)");
      const common = {
        id: op.id,
        x: op.x,
        y: op.y,
        width: op.width ?? 240,
        height: op.height ?? 160,
        version: 1,
      };
      if (op.kind === "connection") {
        requireBoard(op.source && op.target, 400, "Connection requires source and target");
        element = {
          ...common,
          type: "connection",
          source: op.source,
          target: op.target,
          sourceHandle: op.sourceHandle ?? "right",
          targetHandle: op.targetHandle ?? "left",
          label: op.label ?? "",
          color: op.color ?? "#429beb",
        };
      } else {
        requireBoard(
          (flowKinds as readonly string[]).includes(op.kind),
          400,
          "Unsupported flow component kind",
        );
        element = {
          ...common,
          type: "component",
          kind: op.kind as FlowKind,
          parentId: op.parentId ?? null,
          props: defaultFlowProps(op.kind as FlowKind),
        };
      }
      elements.push(element);
    } else {
      requireBoard(element && !element.isDeleted, 404, "Shape does not exist");
      requireBoard(element.version < Number.MAX_SAFE_INTEGER, 400, "Invalid shape version");
      element.version++;
    }
    if (op.op === "delete") {
      element.isDeleted = true;
      continue;
    }
    requireBoard(
      [op.text, op.fontSize, op.endX, op.endY, op.background].every((v) => v === undefined),
      400,
      "Native fields are not supported on flow elements",
    );
    if (element.type !== "component")
      requireBoard(
        op.props === undefined && op.parentId === undefined,
        400,
        "Component fields require a component",
      );
    if (element.type !== "connection")
      requireBoard(
        [op.source, op.target, op.sourceHandle, op.targetHandle, op.label].every(
          (v) => v === undefined,
        ),
        400,
        "Connection fields require a connection",
      );
    for (const key of ["x", "y", "width", "height"] as const)
      if (op[key] !== undefined) element[key] = op[key];
    if (element.type === "component") {
      element.props = {
        ...element.props,
        ...op.props,
        ...(op.color === undefined ? {} : { color: op.color }),
      };
      if (op.parentId !== undefined) element.parentId = op.parentId;
    } else if (element.type === "connection") {
      for (const key of [
        "source",
        "target",
        "sourceHandle",
        "targetHandle",
        "label",
        "color",
      ] as const) {
        // Keep the discriminated record strongly typed while copying optional fields.
        if (op[key] !== undefined) Object.assign(element, { [key]: op[key] });
      }
    } else if (op.color !== undefined) element.props.color = op.color;
  }
  // Deleting a parent or endpoint without deleting/reparenting all relations fails closed.
  // Validate only the final graph, so explicit related deletions may appear in any order.
  // The engine dispatcher validates this complete candidate through validateScene,
  // including graph schema, relationships, serialized size and raster budgets.
  return { ...scene, elements };
}

export function flowSummary(
  element: FlowElement,
  files: BoardScene["files"],
): Record<string, unknown> {
  const { id, type, x, y, width, height, version } = element;
  const common = { id, type, x, y, width, height, version };
  if (element.type === "component") {
    const p = element.props;
    // Even JSON-escaped control characters fit one complete summary under 128 KiB.
    const short = (s: string) => s.slice(0, 128);
    const props = {
      ...p,
      title: short(p.title),
      subtitle: short(p.subtitle),
      body: short(p.body),
      fields: p.fields
        .slice(0, 10)
        .map((f) => ({ ...f, label: short(f.label), value: short(f.value) })),
      columns: p.columns.map(short),
      rows: p.rows.slice(0, 5).map((row) => row.map(short)),
    };
    return {
      ...common,
      kind: element.kind,
      parentId: element.parentId,
      props,
      propsTruncated: JSON.stringify(props) !== JSON.stringify(p),
      ...(p.imageId && files[p.imageId]
        ? {
            imageAsset: {
              id: p.imageId,
              mimeType: files[p.imageId].mimeType,
              created: files[p.imageId].created,
            },
          }
        : {}),
    };
  }
  if (element.type === "connection")
    return {
      ...common,
      source: element.source,
      target: element.target,
      sourceHandle: element.sourceHandle,
      targetHandle: element.targetHandle,
      label: element.label,
      color: element.color,
    };
  return {
    ...common,
    ink: {
      color: element.props.color,
      size: element.props.size,
      pressure: element.props.pressure,
      pointCount: element.props.points.length,
      w: element.props.w,
      h: element.props.h,
    },
  };
}
