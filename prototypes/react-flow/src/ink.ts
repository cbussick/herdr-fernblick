import { getStroke } from "perfect-freehand";
import type { Node } from "@xyflow/react";
import type { CanvasNode } from "./model";

export type InkPoint = [number, number, number];
export type InkData = {
  kind: "ink";
  points: InkPoint[];
  color: string;
  size: number;
  pressure: boolean;
  w: number;
  h: number;
};
export type InkNode = Node<InkData, "ink">;
export const maxStrokePoints = 10000;
export const maxBoardPoints = 100000;
export const isInk = (node: CanvasNode): node is InkNode => node.type === "ink";

const outlines = new WeakMap<InkData, number[][]>();
export function outline(data: InkData, complete = true): number[][] {
  const cached = complete && outlines.get(data);
  if (cached) return cached;
  const result = getStroke(data.points, {
    size: data.size,
    thinning: 0.5,
    smoothing: 0.6,
    streamline: 0.4,
    simulatePressure: !data.pressure,
    last: complete,
  });
  if (complete) outlines.set(data, result);
  return result;
}
export function pathFromOutline(points: number[][]): string {
  if (!points.length) return "";
  return `M ${points.map((p) => `${p[0]},${p[1]}`).join(" L ")} Z`;
}
export function makeInk(
  id: string,
  points: InkPoint[],
  color: string,
  size: number,
  pressure: boolean,
): InkNode {
  const draft: InkData = { kind: "ink", points, color, size, pressure, w: 1, h: 1 };
  const polygon = outline(draft);
  const xs = polygon.map((p) => p[0]!);
  const ys = polygon.map((p) => p[1]!);
  const x = Math.min(...xs) - 2;
  const y = Math.min(...ys) - 2;
  const w = Math.max(8, Math.max(...xs) - x + 2);
  const h = Math.max(8, Math.max(...ys) - y + 2);
  return {
    id,
    type: "ink",
    position: { x, y },
    data: { ...draft, points: points.map((p) => [p[0] - x, p[1] - y, p[2]]), w, h },
    style: { width: w, height: h },
    zIndex: 2000,
    connectable: false,
    ariaLabel: "Freehand stroke",
  };
}
export function validInk(v: unknown): v is InkData {
  if (!v || typeof v !== "object") return false;
  const d = v as InkData;
  const finite = (n: unknown): n is number =>
    typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= 1e6;
  return (
    d.kind === "ink" &&
    typeof d.color === "string" &&
    /^#[a-f\d]{6}$/i.test(d.color) &&
    finite(d.size) &&
    d.size >= 1 &&
    d.size <= 24 &&
    typeof d.pressure === "boolean" &&
    finite(d.w) &&
    finite(d.h) &&
    d.w >= 1 &&
    d.h >= 1 &&
    Array.isArray(d.points) &&
    d.points.length > 0 &&
    d.points.length <= maxStrokePoints &&
    d.points.every(
      (p) =>
        Array.isArray(p) &&
        p.length === 3 &&
        finite(p[0]) &&
        finite(p[1]) &&
        finite(p[2]) &&
        p[2] >= 0 &&
        p[2] <= 1,
    )
  );
}
export function inkDimensions(node: InkNode) {
  return {
    w: node.width ?? Number(node.style?.width ?? node.data.w),
    h: node.height ?? Number(node.style?.height ?? node.data.h),
  };
}
function distance(p: number[], a: number[], b: number[]): number {
  const dx = b[0]! - a[0]!;
  const dy = b[1]! - a[1]!;
  const t = Math.max(
    0,
    Math.min(1, ((p[0]! - a[0]!) * dx + (p[1]! - a[1]!) * dy) / (dx * dx + dy * dy || 1)),
  );
  return Math.hypot(p[0]! - a[0]! - t * dx, p[1]! - a[1]! - t * dy);
}
function segmentsCross(a: number[], b: number[], c: number[], d: number[]) {
  const cross = (p: number[], q: number[], r: number[]) =>
    (q[0]! - p[0]!) * (r[1]! - p[1]!) - (q[1]! - p[1]!) * (r[0]! - p[0]!);
  return cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0;
}
/** Test the rendered polygon, including resized strokes, against the complete eraser sweep. */
export function hitsInk(node: InkNode, from: number[], to: number[], radius: number): boolean {
  const { w, h } = inkDimensions(node);
  if (
    Math.max(from[0]!, to[0]!) + radius < node.position.x ||
    Math.min(from[0]!, to[0]!) - radius > node.position.x + w ||
    Math.max(from[1]!, to[1]!) + radius < node.position.y ||
    Math.min(from[1]!, to[1]!) - radius > node.position.y + h
  )
    return false;
  const polygon = outline(node.data).map((p) => [
    node.position.x + (p[0]! * w) / node.data.w,
    node.position.y + (p[1]! * h) / node.data.h,
  ]);
  let winding = 0;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[j]!;
    const b = polygon[i]!;
    const side = (b[0]! - a[0]!) * (from[1]! - a[1]!) - (from[0]! - a[0]!) * (b[1]! - a[1]!);
    if (a[1]! <= from[1]! && b[1]! > from[1]! && side > 0) winding++;
    else if (a[1]! > from[1]! && b[1]! <= from[1]! && side < 0) winding--;
    if (
      segmentsCross(from, to, a, b) ||
      Math.min(
        distance(from, a, b),
        distance(to, a, b),
        distance(a, from, to),
        distance(b, from, to),
      ) <= radius
    )
      return true;
  }
  return winding !== 0;
}
export type InkCommand = { before: InkNode[]; after: InkNode[] };
export function cleanInk(nodes: InkNode[]): InkNode[] {
  return nodes.map(({ selected: _s, dragging: _d, measured: _m, resizing: _r, ...n }) =>
    structuredClone({
      ...n,
      style: {
        ...n.style,
        ...(n.width !== undefined ? { width: n.width } : {}),
        ...(n.height !== undefined ? { height: n.height } : {}),
      },
    }),
  );
}
/** Apply only the touched stroke IDs. Component edits never get reverted by drawing undo. */
export function applyInkCommand(
  nodes: CanvasNode[],
  command: InkCommand,
  undo: boolean,
): CanvasNode[] {
  const touched = new Set([...command.before, ...command.after].map((n) => n.id));
  return [
    ...nodes.filter((n) => !touched.has(n.id)),
    ...cleanInk(undo ? command.before : command.after),
  ];
}
export function gestureViewport(
  start: { x: number; y: number; zoom: number },
  first: { x: number; y: number },
  second: { x: number; y: number },
  nextFirst: { x: number; y: number },
  nextSecond: { x: number; y: number },
) {
  const distance = (a: typeof first, b: typeof second) => Math.hypot(a.x - b.x, a.y - b.y);
  const zoom = Math.max(
    0.15,
    Math.min(
      2,
      (start.zoom * distance(nextFirst, nextSecond)) / Math.max(1, distance(first, second)),
    ),
  );
  const middle = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
  const nextMiddle = { x: (nextFirst.x + nextSecond.x) / 2, y: (nextFirst.y + nextSecond.y) / 2 };
  return {
    x: nextMiddle.x - ((middle.x - start.x) * zoom) / start.zoom,
    y: nextMiddle.y - ((middle.y - start.y) * zoom) / start.zoom,
    zoom,
  };
}
