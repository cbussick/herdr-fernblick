import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import { getSmoothStepPath, Position } from "@xyflow/react";
import type { BoardScene } from "../../../packages/pi-live-chat/boardProtocol";
import {
  boardImageLimits,
  type BoardImageQuality,
} from "../../../packages/pi-live-chat/boardImageExport";
import {
  FLOW_CONNECTION_WIDTH,
  validateFlowGraph,
} from "../../../packages/pi-live-chat/flowProtocol";
import { ComponentContent, componentStyle } from "./Components";
import { PrimitiveSvg } from "./Primitives";
import { outline, pathFromOutline } from "./ink";
import { toDiagram, validateScene } from "./scene";
import styles from "./Playground.module.css";
import renderStyles from "./Render.module.css";
import "@fontsource/nunito/400.css";
import "@fontsource/nunito/600.css";
import "@fontsource/nunito/700.css";

export type Bounds = { x: number; y: number; width: number; height: number };
export function fittedOutput(bounds: Bounds, scale = 1, quality?: BoardImageQuality) {
  if (!Number.isFinite(scale) || scale <= 0 || scale > 1)
    throw new Error("Render scale must be greater than zero and at most one");
  const limits = boardImageLimits(quality);
  const width = Math.max(1, bounds.width + 64),
    height = Math.max(1, bounds.height + 64);
  const zoom =
    Math.min(
      limits.scale,
      limits.maxSide / width,
      limits.maxSide / height,
      Math.sqrt(limits.maxPixels / (width * height)),
    ) * scale;
  return {
    width: Math.max(1, Math.floor(width * zoom)),
    height: Math.max(1, Math.floor(height * zoom)),
    zoom,
  };
}
const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
async function loadResources(host: HTMLElement) {
  for (const weight of [400, 600, 700]) {
    const faces = await document.fonts.load(
      `${weight} 16px Nunito`,
      `Board ${host.textContent || ""}`,
    );
    if (!faces.length || faces.some((face) => face.status !== "loaded"))
      throw new Error("Local Nunito font failed to load");
  }
  await document.fonts.ready;
  let pixels = 0;
  await Promise.all(
    Array.from(host.querySelectorAll("img")).map(async (img) => {
      try {
        await img.decode();
      } catch {
        throw new Error("Board image failed to load");
      }
      if (
        !img.naturalWidth ||
        !img.naturalHeight ||
        img.naturalWidth > 32768 ||
        img.naturalHeight > 32768
      )
        throw new Error("Invalid board image dimensions");
      pixels += img.naturalWidth * img.naturalHeight;
      if (pixels > 32 * 1024 * 1024) throw new Error("Board images exceed decoded pixel budget");
    }),
  );
}
let root: Root | undefined;
let busy = false;
/** Isolated DOM screenshot entry. No editor/controller, APIs, storage or arbitrary markup. */
export async function prepareFlowBoardScene(
  input: BoardScene,
  scale = 1,
  quality?: BoardImageQuality,
): Promise<{ width: number; height: number }> {
  if (busy) throw new Error("A scene is already being prepared");
  busy = true;
  try {
    const scene = validateScene(input),
      diagram = toDiagram(scene),
      elements = validateFlowGraph(scene).filter((e) => !e.isDeleted);
    const host = document.getElementById("flow-render-root");
    if (!host) throw new Error("Renderer root is missing");
    const position = (id: string): { x: number; y: number } => {
      const n = diagram.nodes.find((n) => n.id === id)!;
      const parent = n.parentId ? diagram.nodes.find((p) => p.id === n.parentId) : undefined;
      return {
        x: n.position.x + (parent?.position.x ?? 0),
        y: n.position.y + (parent?.position.y ?? 0),
      };
    };
    const previousLayer = host.querySelector<HTMLElement>("[data-render-layer]");
    if (previousLayer) {
      previousLayer.style.transform = "";
      previousLayer.querySelectorAll("[data-render-connections]").forEach((el) => el.remove());
    }
    root ??= createRoot(host);
    const nodes = diagram.nodes.map((n) => {
      const p = position(n.id);
      if (n.type === "primitive")
        return (
          <div
            key={n.id}
            data-render-node={n.id}
            className={renderStyles.node}
            style={{ left: p.x, top: p.y, width: n.width, height: n.height }}
          >
            <PrimitiveSvg shape={n.data.shape} drawing={n.data.drawing} />
          </div>
        );
      if (n.type === "ink")
        return (
          <svg
            key={n.id}
            data-render-node={n.id}
            className={renderStyles.node}
            style={{ left: p.x, top: p.y, width: n.width, height: n.height }}
            viewBox={`0 0 ${n.data.w} ${n.data.h}`}
            preserveAspectRatio="none"
          >
            <path d={pathFromOutline(outline(n.data))} fill={n.data.color} />
          </svg>
        );
      return (
        <div
          key={n.id}
          data-render-node={n.id}
          className={`${styles["component"]} ${renderStyles.node}`}
          data-kind={n.data.kind}
          style={{
            ...componentStyle(n.data),
            left: p.x,
            top: p.y,
            width: n.width,
            height: n.data.kind === "boundary" ? n.height : "auto",
            minHeight: Number(n.style?.minHeight ?? n.height ?? 80),
            zIndex: n.data.kind === "boundary" ? -1 : 0,
          }}
        >
          <ComponentContent data={n.data} />
        </div>
      );
    });
    flushSync(() =>
      root!.render(
        <div
          className={`${styles["app"]} ${renderStyles.page}`}
          style={{ background: scene.background }}
        >
          <div data-render-layer className={renderStyles.layer}>
            {nodes}
          </div>
        </div>,
      ),
    );
    await loadResources(host);
    await nextFrame();
    const layer = host.querySelector<HTMLElement>("[data-render-layer]")!;
    const boxes = new Map(
      Array.from(layer.querySelectorAll<HTMLElement>("[data-render-node]")).map((el) => [
        el.dataset.renderNode!,
        el.getBoundingClientRect(),
      ]),
    );
    const origin = layer.getBoundingClientRect();
    const point = (id: string, handle: string) => {
      const box = boxes.get(id)!;
      return {
        x:
          box.left -
          origin.left +
          (handle === "left" ? 0 : handle === "right" ? box.width : box.width / 2),
        y:
          box.top -
          origin.top +
          (handle === "top" ? 0 : handle === "bottom" ? box.height : box.height / 2),
      };
    };
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.classList.add(renderStyles.connections);
    svg.setAttribute("data-render-connections", "");
    // Build only trusted SVG primitives, never parse user markup or URLs.
    for (const e of elements)
      if (e.type === "connection") {
        const a = point(e.source, e.sourceHandle),
          b = point(e.target, e.targetHandle);
        const [d, x, y] = getSmoothStepPath({
          sourceX: a.x,
          sourceY: a.y,
          targetX: b.x,
          targetY: b.y,
          sourcePosition: e.sourceHandle as Position,
          targetPosition: e.targetHandle as Position,
        });
        const path = document.createElementNS(svg.namespaceURI, "path");
        path.setAttribute("d", d);
        path.setAttribute("fill", "none");
        path.setAttribute("stroke", e.color);
        path.setAttribute("stroke-width", String(FLOW_CONNECTION_WIDTH));
        svg.append(path);
        const arrow = document.createElementNS(svg.namespaceURI, "path");
        const angle = { top: -90, right: 0, bottom: 90, left: 180 }[e.targetHandle];
        arrow.setAttribute("d", "M 0 0 L 8 -4 L 8 4 Z");
        arrow.setAttribute("fill", e.color);
        arrow.setAttribute("transform", `translate(${b.x} ${b.y}) rotate(${angle})`);
        svg.append(arrow);
        if (e.label) {
          const text = document.createElementNS(svg.namespaceURI, "text");
          text.setAttribute("x", String(x));
          text.setAttribute("y", String(y));
          text.setAttribute("text-anchor", "middle");
          text.setAttribute("fill", e.color);
          text.textContent = e.label;
          svg.append(text);
        }
      }
    layer.append(svg);
    await nextFrame();
    const rects = Array.from(
      layer.querySelectorAll("[data-render-node], [data-render-node] *, svg path, svg text"),
    )
      .map((el) => el.getBoundingClientRect())
      .filter((r) => r.width || r.height);
    const minX = rects.length ? Math.min(...rects.map((r) => r.left - origin.left)) : 0,
      minY = rects.length ? Math.min(...rects.map((r) => r.top - origin.top)) : 0;
    const maxX = rects.length ? Math.max(...rects.map((r) => r.right - origin.left)) : 256,
      maxY = rects.length ? Math.max(...rects.map((r) => r.bottom - origin.top)) : 192;
    const output = fittedOutput(
      { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
      scale,
      quality,
    );
    host.style.width = `${output.width}px`;
    host.style.height = `${output.height}px`;
    layer.style.transform = `translate(${(32 - minX) * output.zoom}px,${(32 - minY) * output.zoom}px) scale(${output.zoom})`;
    await nextFrame();
    await nextFrame();
    return { width: output.width, height: output.height };
  } finally {
    busy = false;
  }
}
