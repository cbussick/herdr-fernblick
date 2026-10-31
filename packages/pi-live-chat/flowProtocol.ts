import { z } from "zod";

// Shared, data-only contracts. No React, arbitrary HTML, CSS, scripts or network URLs.
export const flowIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);
const color = z.string().regex(/^#[a-fA-F0-9]{6}$/);
const coordinate = z.number().finite().min(-1_000_000).max(1_000_000);
const dimension = z.number().finite().min(1).max(100_000);
const text = z.string().max(4000);
export const flowKinds = ["boundary", "card", "icon", "detail", "table", "comment"] as const;
export type FlowKind = (typeof flowKinds)[number];
export const flowIcons = [
  "",
  "user",
  "users",
  "server",
  "database",
  "cloud",
  "globe",
  "lock",
  "code",
  "settings",
  "zap",
  "mail",
  "heart",
  "box",
  "layout",
  "list",
  "table",
  "message",
  "file",
  "image",
] as const;
export const flowComponentPropsSchema = z
  .object({
    title: text,
    subtitle: text,
    body: text,
    color,
    icon: z.enum(flowIcons),
    imageId: flowIdSchema.nullable(),
    fields: z
      .array(
        z
          .object({
            label: text,
            value: text,
            color: color.or(z.literal("")),
            type: z.enum(["text", "group"]),
          })
          .strict(),
      )
      .max(100),
    columns: z.array(z.string().max(256)).min(1).max(20),
    rows: z.array(z.array(text).max(20)).max(100),
  })
  .strict();
export type FlowComponentProps = z.infer<typeof flowComponentPropsSchema>;
export const flowInkPropsSchema = z
  .object({
    points: z
      .array(z.tuple([coordinate, coordinate, z.number().min(0).max(1)]))
      .min(1)
      .max(10000),
    color,
    size: z.number().min(1).max(24),
    pressure: z.boolean(),
    w: dimension,
    h: dimension,
  })
  .strict();
export type FlowInkProps = z.infer<typeof flowInkPropsSchema>;
const common = {
  id: flowIdSchema,
  x: coordinate,
  y: coordinate,
  width: dimension,
  height: dimension,
  version: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  isDeleted: z.boolean().optional(),
};
export const flowElementSchema = z.discriminatedUnion("type", [
  z
    .object({
      ...common,
      type: z.literal("component"),
      kind: z.enum(flowKinds),
      props: flowComponentPropsSchema,
      parentId: flowIdSchema.nullable(),
    })
    .strict(),
  z.object({ ...common, type: z.literal("ink"), props: flowInkPropsSchema }).strict(),
  z
    .object({
      ...common,
      type: z.literal("connection"),
      source: flowIdSchema,
      target: flowIdSchema,
      sourceHandle: z.enum(["top", "right", "bottom", "left"]),
      targetHandle: z.enum(["top", "right", "bottom", "left"]),
      label: z.string().max(256),
      color,
    })
    .strict(),
]);
export type FlowElement = z.infer<typeof flowElementSchema>;
export const flowElementsSchema = z.array(flowElementSchema).max(2000);

export const flowCatalog = flowKinds.map((kind) => ({
  id: kind,
  name: {
    boundary: "Boundary",
    card: "Card",
    icon: "Icon Node",
    detail: "Detail Node",
    table: "Table Node",
    comment: "Comment Node",
  }[kind],
  description: {
    boundary: "Labeled colored container; contained components move with it.",
    card: "Title and body content card.",
    icon: "Icon or image with primary and secondary labels.",
    detail: "Title, subtitle and editable text/grouped fields, with row highlights.",
    table: "Title, subtitle and editable columns and rows.",
    comment: "Tinted annotation with title, subtitle, body and optional icon/image.",
  }[kind],
  editableProps: [
    "title",
    "subtitle",
    "body",
    "color",
    "icon",
    "imageId",
    ...(kind === "detail" ? ["fields"] : []),
    ...(kind === "table" ? ["columns", "rows"] : []),
  ],
}));
export function defaultFlowProps(kind: FlowKind): FlowComponentProps {
  return {
    title: flowCatalog.find((item) => item.id === kind)!.name,
    subtitle: "",
    body: "",
    color: "#429beb",
    icon: (
      {
        boundary: "box",
        card: "",
        icon: "user",
        detail: "list",
        table: "table",
        comment: "message",
      } as const
    )[kind],
    imageId: null,
    fields: [{ label: "Name", value: "Value", color: "", type: "text" }],
    columns: ["Name", "Value"],
    rows: [["First item", ""]],
  };
}

/** Validate the entire relationship graph, not just individual JSON records. */
export function validateFlowGraph(scene: {
  elements: unknown[];
  files: Record<string, unknown>;
}): FlowElement[] {
  const elements = flowElementsSchema.parse(scene.elements);
  const records = new Map<string, FlowElement>();
  let nodes = 0,
    connections = 0,
    points = 0;
  for (const e of elements) {
    if (records.has(e.id)) throw new Error("Duplicate flow element ID");
    records.set(e.id, e);
    if (e.isDeleted) continue;
    if (e.type === "connection") connections++;
    else nodes++;
    if (e.type === "ink") points += e.props.points.length;
    if (e.type === "component") {
      if (e.props.rows.some((row) => row.length !== e.props.columns.length))
        throw new Error("Table row/column count mismatch");
      if (e.props.imageId !== null && !Object.hasOwn(scene.files, e.props.imageId))
        throw new Error("Component image asset is missing");
    }
  }
  if (nodes > 300 || connections > 1000 || points > 100000)
    throw new Error("Flow canvas exceeds its node, connection or ink-point limits");
  for (const e of elements.filter((e) => !e.isDeleted)) {
    if (e.type === "component" && e.parentId !== null) {
      const parent = records.get(e.parentId);
      if (
        e.kind === "boundary" ||
        parent?.isDeleted ||
        parent?.type !== "component" ||
        parent.kind !== "boundary"
      )
        throw new Error("Invalid component boundary");
    }
    if (e.type === "connection") {
      const source = records.get(e.source),
        target = records.get(e.target);
      if (
        e.source === e.target ||
        source?.isDeleted ||
        target?.isDeleted ||
        source?.type !== "component" ||
        target?.type !== "component"
      )
        throw new Error("Invalid connection endpoint");
    }
  }
  return elements;
}
