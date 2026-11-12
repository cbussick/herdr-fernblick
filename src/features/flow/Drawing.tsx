import {
  createContext,
  useContext,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  NodeResizer,
  useReactFlow,
  useViewport,
  type NodeProps,
  type Viewport,
} from "@xyflow/react";
import { Blocks, Eraser, Hand, MousePointer2, Pencil, Redo2, Undo2 } from "lucide-react";
import {
  gestureViewport,
  hitsInk,
  isInk,
  makeInk,
  maxBoardPoints,
  maxStrokePoints,
  outline,
  pathFromOutline,
  type InkData,
  type InkNode,
  type InkPoint,
} from "./ink";
import { makeId, type CanvasNode } from "./model";
import styles from "./Playground.module.css";

export type Tool = "select" | "draw" | "erase" | "pan";
export const InkContext = createContext({
  hidden: new Set<string>(),
  start: (_id: string) => {},
  finish: (_id: string) => {},
});
export function InkView({ id, data, selected }: NodeProps<InkNode>) {
  const context = useContext(InkContext);
  return (
    <div
      className={styles["ink-node"]}
      data-testid={`stroke-${id}`}
      style={{ opacity: context.hidden.has(id) ? 0 : 1 }}
    >
      <NodeResizer
        isVisible={selected}
        minWidth={8}
        minHeight={8}
        color={data.color}
        handleClassName={styles["no-drag"]}
        lineClassName={styles["no-drag"]}
        onResizeStart={() => context.start(id)}
        onResizeEnd={() => requestAnimationFrame(() => context.finish(id))}
      />
      <svg
        viewBox={`0 0 ${data.w} ${data.h}`}
        preserveAspectRatio="none"
        className={styles["ink-svg"]}
        aria-label="Freehand stroke"
      >
        <path d={pathFromOutline(outline(data))} fill={data.color} />
      </svg>
    </div>
  );
}

export function DrawingTools({
  tool,
  setTool,
  color,
  setColor,
  size,
  setSize,
  history,
  disabled,
  onAddComponent,
  picking = false,
}: {
  tool: Tool;
  setTool: (t: Tool) => void;
  color: string;
  setColor: (c: string) => void;
  size: number;
  setSize: (s: number) => void;
  history: { undo: () => void; redo: () => void; canUndo: boolean; canRedo: boolean };
  disabled: boolean;
  onAddComponent?: () => void;
  picking?: boolean;
}) {
  return (
    <div className={styles["drawing-toolbar"]} aria-label="Drawing tools">
      {(
        [
          { tool: "select", label: "Select", icon: MousePointer2 },
          { tool: "draw", label: "Draw", icon: Pencil },
          { tool: "erase", label: "Eraser", icon: Eraser },
          { tool: "pan", label: "Pan", icon: Hand },
        ] as const
      ).map((item) => (
        <button
          type="button"
          key={item.tool}
          aria-label={item.label}
          title={item.label}
          aria-pressed={tool === item.tool}
          disabled={disabled}
          onClick={() => setTool(item.tool)}
        >
          <item.icon size={17} />
          <span>{item.label}</span>
        </button>
      ))}
      <span className={styles["tool-divider"]} />
      <label className={styles["pen-color"]} title="Pen color">
        <input
          aria-label="Pen color"
          type="color"
          value={color}
          disabled={disabled}
          onChange={(e) => setColor(e.target.value)}
        />
      </label>
      <label className={styles["pen-width"]}>
        Pen width
        <select
          aria-label="Pen width"
          value={size}
          disabled={disabled}
          onChange={(e) => setSize(Number(e.target.value))}
        >
          <option value={2}>Fine</option>
          <option value={5}>Medium</option>
          <option value={10}>Bold</option>
          <option value={18}>Thick</option>
        </select>
      </label>
      {onAddComponent && (
        <div className={styles["tool-group"]}>
          <span className={styles["tool-divider"]} />
          <button
            type="button"
            className={styles["add-component"]}
            aria-label="Add a component"
            title="Add a component"
            aria-haspopup="dialog"
            aria-expanded={picking}
            disabled={disabled}
            onClick={onAddComponent}
          >
            <Blocks size={17} />
            <span>Add component</span>
          </button>
        </div>
      )}
      <span className={styles["tool-divider"]} />
      <button
        type="button"
        aria-label="Undo"
        title="Undo your last edit (Ctrl/Cmd+Z)"
        disabled={disabled || !history.canUndo}
        onClick={history.undo}
      >
        <Undo2 size={17} />
      </button>
      <button
        type="button"
        aria-label="Redo"
        title="Redo your last edit (Ctrl/Cmd+Shift+Z)"
        disabled={disabled || !history.canRedo}
        onClick={history.redo}
      >
        <Redo2 size={17} />
      </button>
    </div>
  );
}

type Pointer = { x: number; y: number };
type Active = {
  id: number;
  type: string;
  points: InkPoint[];
  last: InkPoint;
  pressure: boolean;
  color: string;
  size: number;
};
export function InkSurface({
  tool,
  color,
  size,
  nodes,
  onCommit,
  onHidden,
  onViewport,
  onMessage,
}: {
  tool: "draw" | "erase";
  color: string;
  size: number;
  nodes: CanvasNode[];
  onCommit: (before: InkNode[], after: InkNode[]) => void;
  onHidden: (ids: Set<string>) => void;
  onViewport: (v: Viewport) => void;
  onMessage: (message: string) => void;
}) {
  const flow = useReactFlow<CanvasNode>();
  const viewport = useViewport();
  const svg = useRef<SVGSVGElement>(null);
  const active = useRef<Active | null>(null);
  const pointers = useRef(new Map<number, Pointer>());
  const multi = useRef(false);
  const pinch = useRef<{ viewport: Viewport; first: Pointer; second: Pointer } | null>(null);
  const erased = useRef(new Set<string>());
  const frame = useRef<number | null>(null);
  const [live, setLive] = useState<InkData | null>(null);
  const [cursor, setCursor] = useState<Pointer | null>(null);
  const reset = () => {
    active.current = null;
    erased.current.clear();
    onHidden(new Set());
    setLive(null);
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
  };
  const cancel = () => {
    reset();
    pointers.current.clear();
    multi.current = false;
    pinch.current = null;
  };
  const cancelGesture = useEffectEvent(cancel);
  useEffect(() => {
    const blur = () => cancelGesture();
    const visibility = () => {
      if (document.hidden) blur();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") blur();
    };
    window.addEventListener("blur", blur);
    window.addEventListener("keydown", key);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      blur();
      window.removeEventListener("blur", blur);
      window.removeEventListener("keydown", key);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [tool]);
  useEffect(() => {
    const element = svg.current!;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (active.current || pointers.current.size) return;
      const rect = element.getBoundingClientRect();
      const p = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      const v = flow.getViewport();
      const zoom = Math.max(
        0.15,
        Math.min(2, v.zoom * Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.002))),
      );
      const next = {
        x: p.x - ((p.x - v.x) * zoom) / v.zoom,
        y: p.y - ((p.y - v.y) * zoom) / v.zoom,
        zoom,
      };
      void flow.setViewport(next);
      onViewport(next);
    };
    // iPadOS Scribble can swallow alternate pen strokes even with touch-action:none
    // and pointerdown.preventDefault. Cancel the *native touchstart* default too,
    // as Excalidraw does (upstream PR #7494). Keep other platforms untouched.
    // This surface spans the entire canvas, but only exists in Draw/Eraser mode;
    // toolbar buttons and dialog text fields are outside it.
    const appleTouch =
      /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (/Mac/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
    const suppressScribble = (event: TouchEvent) => {
      if (event.cancelable) event.preventDefault();
    };
    if (appleTouch) element.addEventListener("touchstart", suppressScribble, { passive: false });
    element.addEventListener("wheel", wheel, { passive: false });
    return () => {
      element.removeEventListener("wheel", wheel);
      if (appleTouch) element.removeEventListener("touchstart", suppressScribble);
    };
  }, [flow, onViewport]);
  function local(event: { clientX: number; clientY: number }) {
    const rect = svg.current!.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }
  function point(event: { clientX: number; clientY: number; pressure: number }): InkPoint {
    const p = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY });
    return [
      p.x,
      p.y,
      event.pressure > 0 ? Math.min(1, event.pressure) : (active.current?.last[2] ?? 0.5),
    ];
  }
  function preview() {
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      const a = active.current;
      if (a)
        setLive({
          kind: "ink",
          points: a.points.slice(),
          color: a.color,
          size: a.size,
          pressure: a.pressure,
          w: 1,
          h: 1,
        });
    });
  }
  function erase(from: InkPoint, to: InkPoint) {
    let changed = false;
    for (const node of nodes)
      if (
        isInk(node) &&
        !erased.current.has(node.id) &&
        hitsInk(node, from, to, 10 / flow.getZoom())
      ) {
        erased.current.add(node.id);
        changed = true;
      }
    if (changed) onHidden(new Set(erased.current));
  }
  function down(event: ReactPointerEvent<SVGSVGElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    if (active.current?.type === "pen" && event.pointerType === "touch") return; // Ignore palms while the pen is down.
    // A Pencil must also win when the palm arrived FIRST. Discard any provisional
    // touch ink/pinch state; those old touch IDs can no longer cancel or finish this pen.
    if (event.pointerType === "pen") cancel();
    // Recover from a native selection left by an older build or interrupted gesture.
    window.getSelection()?.removeAllRanges();
    svg.current!.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, local(event));
    if (pointers.current.size > 1) {
      reset();
      multi.current = true;
      const [first, second] = [...pointers.current.values()];
      pinch.current = { viewport: flow.getViewport(), first: first!, second: second! };
      return;
    }
    if (multi.current) return;
    if (
      tool === "draw" &&
      (nodes.length >= 300 ||
        nodes.filter(isInk).reduce((sum, n) => sum + n.data.points.length, 0) >= maxBoardPoints)
    ) {
      onMessage("Drawing limit reached. Delete some strokes or components first.");
      return;
    }
    const p = point(event);
    active.current = {
      id: event.pointerId,
      type: event.pointerType,
      points: [p],
      last: p,
      pressure: event.pointerType === "pen",
      color,
      size,
    };
    if (tool === "draw") preview();
    else erase(p, p);
  }
  function move(event: ReactPointerEvent<SVGSVGElement>) {
    event.stopPropagation();
    if (tool === "erase") setCursor(local(event));
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, local(event));
    if (multi.current) {
      if (pointers.current.size >= 2 && pinch.current) {
        const [first, second] = [...pointers.current.values()];
        const start = pinch.current;
        const next = gestureViewport(start.viewport, start.first, start.second, first!, second!);
        void flow.setViewport(next);
        onViewport(next);
      }
      return;
    }
    const a = active.current;
    if (!a || a.id !== event.pointerId) return;
    const samples = event.nativeEvent.getCoalescedEvents?.() || [];
    for (const sample of samples.length ? samples : [event.nativeEvent]) {
      const p = point(sample);
      if (tool === "erase") erase(a.last, p);
      else if (
        a.points.length < maxStrokePoints &&
        Math.hypot(p[0] - a.last[0], p[1] - a.last[1]) >= 0.2 / flow.getZoom()
      )
        a.points.push(p);
      a.last = p;
    }
    if (tool === "draw") preview();
  }
  function up(event: ReactPointerEvent<SVGSVGElement>) {
    event.preventDefault();
    event.stopPropagation();
    pointers.current.delete(event.pointerId);
    if (multi.current) {
      if (!pointers.current.size) cancel();
      else if (pointers.current.size >= 2) {
        const [first, second] = [...pointers.current.values()];
        pinch.current = { viewport: flow.getViewport(), first: first!, second: second! };
      }
      return;
    }
    const a = active.current;
    if (a?.id === event.pointerId) {
      if (tool === "draw") {
        const p = point(event);
        if (a.points.length < maxStrokePoints && (p[0] !== a.last[0] || p[1] !== a.last[1]))
          a.points.push(p);
        const used = nodes.filter(isInk).reduce((sum, n) => sum + n.data.points.length, 0);
        const points = a.points.slice(0, maxBoardPoints - used);
        if (points.length) onCommit([], [makeInk(makeId(), points, a.color, a.size, a.pressure)]);
      } else
        onCommit(
          nodes.filter(isInk).filter((n) => erased.current.has(n.id)),
          [],
        );
      reset();
    }
    if (svg.current!.hasPointerCapture(event.pointerId))
      svg.current!.releasePointerCapture(event.pointerId);
  }
  return (
    <svg
      ref={svg}
      data-testid="ink-surface"
      data-tool={tool}
      className={styles["ink-surface"]}
      aria-label={tool === "draw" ? "Freehand drawing surface" : "Whole-stroke eraser surface"}
      onContextMenu={(event) => event.preventDefault()}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={(event) => {
        if (pointers.current.has(event.pointerId)) cancel();
      }}
      onLostPointerCapture={(event) => {
        if (active.current?.id === event.pointerId || pointers.current.has(event.pointerId))
          cancel();
      }}
      onPointerLeave={() => setCursor(null)}
    >
      {live && (
        <g transform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.zoom})`}>
          <path d={pathFromOutline(outline(live, false))} fill={live.color} />
        </g>
      )}
      {tool === "erase" && cursor && (
        <circle cx={cursor.x} cy={cursor.y} r={10} className={styles["eraser-cursor"]} />
      )}
    </svg>
  );
}
