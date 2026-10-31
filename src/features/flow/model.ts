import { MarkerType, type Edge, type Node } from "@xyflow/react";
import {
  flowCatalog,
  flowKinds,
  defaultFlowProps,
  flowComponentPropsSchema,
  type FlowComponentProps,
  type FlowKind,
} from "../../../packages/pi-live-chat/flowProtocol";
import type { InkNode } from "./ink";
export const kinds = flowKinds;
export type Kind = FlowKind;
export const catalog = Object.fromEntries(
  flowCatalog.map((item) => [item.id, { ...item, icon: defaultFlowProps(item.id).icon }]),
) as unknown as Record<Kind, { name: string; description: string; icon: string }>;
export const colors = ["#f28b3c", "#e2bd35", "#429beb", "#43b879", "#eb6666", "#9170e8", "#596579"];
// Image data is transient UI state only. scene.ts moves it to the asset map at the boundary.
export type ComponentData = Omit<FlowComponentProps, "imageId"> & { kind: Kind; image: string };
export type ComponentNode = Node<ComponentData, "component">;
export type CanvasNode = ComponentNode | InkNode;
export type Diagram = { nodes: CanvasNode[]; edges: Edge[] };
export function makeId() {
  return `flow-${Array.from(crypto.getRandomValues(new Uint32Array(4)), (n) => n.toString(16).padStart(8, "0")).join("")}`;
}
export function defaults(kind: Kind): ComponentData {
  const { imageId: _imageId, ...props } = defaultFlowProps(kind);
  return { ...props, kind, image: "", color: colors[kinds.indexOf(kind)]! };
}
export function validData(data: ComponentData): boolean {
  const { kind: _kind, image, ...props } = data;
  return (
    flowComponentPropsSchema.safeParse({ ...props, imageId: null }).success &&
    (!image || /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/]*={0,2}$/.test(image))
  );
}
export function makeNode(
  kind: Kind,
  x: number,
  y: number,
  data = defaults(kind),
  id = makeId(),
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
export const edgeOptions = {
  type: "smoothstep",
  markerEnd: { type: MarkerType.ArrowClosed },
  style: { stroke: "#8290a3", strokeWidth: 1.6 },
};
