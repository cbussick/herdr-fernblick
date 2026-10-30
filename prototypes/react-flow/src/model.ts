import { MarkerType, type Edge, type Node, type Viewport } from "@xyflow/react";
import { maxBoardPoints, validInk, type InkNode } from "./ink";

export const kinds = ["boundary", "card", "icon", "detail", "table", "comment"] as const;
export type Kind = (typeof kinds)[number];
export const catalog: Record<Kind, { name: string; description: string; icon: string }> = {
  boundary: {
    name: "Boundary",
    description: "A labeled space for related components",
    icon: "box",
  },
  card: { name: "Card", description: "A simple title and body", icon: "layout" },
  icon: { name: "Icon Node", description: "An icon, title, and subtitle", icon: "user" },
  detail: {
    name: "Detail Node",
    description: "Labeled fields and grouped information",
    icon: "list",
  },
  table: { name: "Table Node", description: "Editable columns and rows", icon: "table" },
  comment: {
    name: "Comment Node",
    description: "A colored note beside your diagram",
    icon: "message",
  },
};
export const colors = ["#f28b3c", "#e2bd35", "#429beb", "#43b879", "#eb6666", "#9170e8", "#596579"];
export type Field = { label: string; value: string; color: string; type: "text" | "group" };
export type ComponentData = {
  kind: Kind;
  title: string;
  subtitle: string;
  body: string;
  color: string;
  icon: string;
  image: string;
  fields: Field[];
  columns: string[];
  rows: string[][];
};
export type ComponentNode = Node<ComponentData, "component">;
export type CanvasNode = ComponentNode | InkNode;
export type Diagram = { nodes: CanvasNode[]; edges: Edge[]; viewport?: Viewport };
export const storageKey = "fernblick-react-flow-playground-v1";

/** Tailnet HTTP is not a secure context, so randomUUID is not always available. */
export function makeId(): string {
  return `node-${Array.from(crypto.getRandomValues(new Uint32Array(4)), (word) => word.toString(16).padStart(8, "0")).join("")}`;
}

export function defaults(kind: Kind): ComponentData {
  return {
    kind,
    title: kind === "icon" ? "User" : catalog[kind].name,
    subtitle: "",
    body: "",
    color: colors[kinds.indexOf(kind)]!,
    icon: kind === "card" ? "" : catalog[kind].icon,
    image: "",
    fields: [{ label: "Name", value: "Value", color: "", type: "text" }],
    columns: ["Name", "Value"],
    rows: [["First item", ""]],
  };
}

export function makeNode(
  kind: Kind,
  x: number,
  y: number,
  data = defaults(kind),
  id: string = makeId(),
): ComponentNode {
  return {
    id,
    type: "component",
    position: { x, y },
    data,
    style:
      kind === "boundary" ? { width: 970, height: 460 } : { width: kind === "icon" ? 160 : 300 },
    ...(kind === "boundary" ? { zIndex: -1 } : {}),
  };
}

export function example(): Diagram {
  const boundary = makeNode(
    "boundary",
    20,
    20,
    { ...defaults("boundary"), title: "Product platform", icon: "cloud" },
    "platform",
  );
  const user = makeNode(
    "icon",
    60,
    95,
    { ...defaults("icon"), title: "User", subtitle: "A nice user", icon: "user" },
    "user",
  );
  const api = makeNode(
    "detail",
    260,
    90,
    {
      ...defaults("detail"),
      title: "User service",
      subtitle: "Application API",
      icon: "server",
      fields: [
        { label: "Port", value: "8080", color: "#fff6da", type: "text" },
        { label: "Environment", value: "Production", color: "#e9f7ee", type: "text" },
        { label: "Responsibilities", value: "Profiles\nPermissions", color: "", type: "group" },
      ],
    },
    "api",
  );
  const table = makeNode(
    "table",
    620,
    90,
    {
      ...defaults("table"),
      title: "Users",
      subtitle: "Database table",
      icon: "database",
      columns: ["Field", "Type"],
      rows: [
        ["id", "UUID"],
        ["name", "Text"],
        ["email", "Text"],
      ],
    },
    "users",
  );
  for (const node of [user, api, table]) {
    node.parentId = boundary.id;
  }
  return {
    nodes: [
      boundary,
      user,
      api,
      table,
      makeNode(
        "card",
        280,
        560,
        {
          ...defaults("card"),
          title: "Start with a component",
          body: "Add one from the library. Double-click it to edit its content, color, and image.",
        },
        "guide",
      ),
      makeNode(
        "comment",
        650,
        560,
        {
          ...defaults("comment"),
          title: "Try it out",
          subtitle: "A separate experiment",
          body: "Drag between the connection dots. Move the boundary to move its contents.",
          icon: "message",
        },
        "note",
      ),
    ],
    edges: [
      {
        id: "user-api",
        source: "user",
        sourceHandle: "right",
        target: "api",
        targetHandle: "left",
        label: "Requests",
        markerEnd: { type: MarkerType.ArrowClosed },
        type: "smoothstep",
      },
      {
        id: "api-users",
        source: "api",
        sourceHandle: "right",
        target: "users",
        targetHandle: "left",
        label: "Reads / writes",
        markerEnd: { type: MarkerType.ArrowClosed },
        type: "smoothstep",
      },
    ],
  };
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const shortText = (v: unknown): v is string => typeof v === "string" && v.length <= 10000;
const color = (v: unknown): v is string => typeof v === "string" && /^#[a-f\d]{6}$/i.test(v);
const finite = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= 1e6;
export function validData(v: unknown): v is ComponentData {
  if (!isObject(v) || !kinds.includes(v.kind as Kind)) return false;
  if (![v.title, v.subtitle, v.body, v.icon].every(shortText) || !color(v.color)) return false;
  if (
    typeof v.image !== "string" ||
    v.image.length > 3000000 ||
    (v.image !== "" && !/^data:image\/(png|jpeg|webp|gif);base64,[a-z\d+/=]+$/i.test(v.image))
  )
    return false;
  if (
    !Array.isArray(v.fields) ||
    v.fields.length > 100 ||
    !v.fields.every(
      (f) =>
        isObject(f) &&
        shortText(f.label) &&
        shortText(f.value) &&
        (f.color === "" || color(f.color)) &&
        (f.type === "text" || f.type === "group"),
    )
  )
    return false;
  const columns = v.columns;
  return (
    Array.isArray(columns) &&
    columns.length > 0 &&
    columns.length <= 20 &&
    columns.every(shortText) &&
    Array.isArray(v.rows) &&
    v.rows.length <= 100 &&
    v.rows.every((r) => Array.isArray(r) && r.length === columns.length && r.every(shortText))
  );
}

/** Local storage is untrusted: reject invalid records rather than mounting arbitrary node types. */
export function restore(raw: string): Diagram {
  if (raw.length > 5000000) throw new Error("Saved board is too large.");
  const value: unknown = JSON.parse(raw);
  if (
    !isObject(value) ||
    (value.version !== 1 && value.version !== 2) ||
    !Array.isArray(value.nodes) ||
    value.nodes.length > 300 ||
    !Array.isArray(value.edges) ||
    value.edges.length > 1000
  )
    throw new Error("Unsupported saved board.");
  const ids = new Set<string>();
  const componentIds = new Set<string>();
  let totalPoints = 0;
  const nodes: CanvasNode[] = value.nodes.map((n: unknown) => {
    if (
      !isObject(n) ||
      typeof n.id !== "string" ||
      ids.has(n.id) ||
      !isObject(n.position) ||
      !finite(n.position.x) ||
      !finite(n.position.y)
    )
      throw new Error("Invalid saved component.");
    if (n.type === "ink") {
      if (
        !validInk(n.data) ||
        n.parentId !== undefined ||
        (totalPoints += n.data.points.length) > maxBoardPoints
      )
        throw new Error("Invalid saved stroke.");
      const width = n.width ?? (isObject(n.style) ? n.style.width : undefined) ?? n.data.w;
      const height = n.height ?? (isObject(n.style) ? n.style.height : undefined) ?? n.data.h;
      if (!finite(width) || width < 1 || !finite(height) || height < 1)
        throw new Error("Invalid stroke size.");
      ids.add(n.id);
      return {
        id: n.id,
        type: "ink",
        position: { x: n.position.x, y: n.position.y },
        data: n.data,
        style: { width, height },
        connectable: false,
        zIndex: 2000,
        ariaLabel: "Freehand stroke",
      };
    }
    if (!validData(n.data)) throw new Error("Invalid saved component.");
    const node = makeNode(n.data.kind, n.position.x, n.position.y, n.data, n.id);
    componentIds.add(n.id);
    if (typeof n.parentId === "string") {
      const parent = (value.nodes as unknown[]).find((p) => isObject(p) && p.id === n.parentId);
      if (
        !isObject(parent) ||
        !validData(parent.data) ||
        parent.data.kind !== "boundary" ||
        !ids.has(n.parentId) ||
        n.data.kind === "boundary"
      )
        throw new Error("Invalid component boundary.");
      node.parentId = n.parentId;
    }
    if (
      isObject(n.style) &&
      finite(n.style.width) &&
      finite(n.style.height) &&
      n.style.width >= 100 &&
      n.style.height >= 60
    )
      node.style = { width: n.style.width, height: n.style.height };
    if (finite(n.width) && n.width >= 100) node.style = { ...node.style, width: n.width };
    if (finite(n.height) && n.height >= 60) node.style = { ...node.style, height: n.height };
    ids.add(n.id);
    return node;
  });
  const edgeIds = new Set<string>();
  const edges: Edge[] = value.edges.map((e: unknown) => {
    if (
      !isObject(e) ||
      typeof e.id !== "string" ||
      edgeIds.has(e.id) ||
      typeof e.source !== "string" ||
      typeof e.target !== "string" ||
      !componentIds.has(e.source) ||
      !componentIds.has(e.target)
    )
      throw new Error("Invalid connection.");
    edgeIds.add(e.id);
    const handles = ["left", "right", "top", "bottom"];
    return {
      id: e.id,
      source: e.source,
      target: e.target,
      type: "smoothstep",
      sourceHandle: handles.includes(e.sourceHandle as string)
        ? (e.sourceHandle as string)
        : "right",
      targetHandle: handles.includes(e.targetHandle as string)
        ? (e.targetHandle as string)
        : "left",
      label: shortText(e.label) ? e.label : "",
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: isObject(e.style) && color(e.style.stroke) ? e.style.stroke : "#8290a3",
      },
      style: { stroke: isObject(e.style) && color(e.style.stroke) ? e.style.stroke : "#8290a3" },
    };
  });
  const v = value.viewport;
  const viewport =
    isObject(v) &&
    finite(v.x) &&
    finite(v.y) &&
    typeof v.zoom === "number" &&
    v.zoom >= 0.15 &&
    v.zoom <= 2
      ? { x: v.x, y: v.y, zoom: v.zoom }
      : undefined;
  return { nodes, edges, viewport };
}

export function serialize(diagram: Diagram): string {
  return JSON.stringify({
    version: 2,
    ...diagram,
    nodes: diagram.nodes.map(
      ({ selected: _selected, dragging: _dragging, measured: _measured, ...node }) => ({
        ...node,
        style: {
          ...node.style,
          ...(node.width !== undefined ? { width: node.width } : {}),
          ...(node.height !== undefined ? { height: node.height } : {}),
        },
      }),
    ),
    edges: diagram.edges.map(({ selected: _selected, ...edge }) => edge),
  });
}
