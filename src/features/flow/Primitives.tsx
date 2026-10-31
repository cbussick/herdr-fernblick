import { NodeResizer, type NodeProps } from "@xyflow/react";
import type {
  PrimitiveKind,
  PrimitiveProps,
} from "../../../packages/pi-live-chat/primitiveProtocol";
import type { PrimitiveNode } from "./model";
import styles from "./Primitives.module.css";

/** Trusted SVG elements only. Never parse markup or spread user-supplied attributes. */
export function PrimitiveSvg({
  shape,
  drawing,
}: {
  shape: PrimitiveKind;
  drawing: PrimitiveProps;
}) {
  return (
    <svg
      className={styles.svg}
      viewBox="-8 -8 116 116"
      preserveAspectRatio="none"
      role="img"
      aria-label={shape === "text" ? drawing.text : `${shape} drawing`}
    >
      <g
        stroke={drawing.stroke}
        strokeWidth={drawing.strokeWidth}
        fill={drawing.fill}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {shape === "rectangle" && <rect x={0} y={0} width={100} height={100} />}
        {shape === "ellipse" && <ellipse cx={50} cy={50} rx={50} ry={50} />}
        {shape === "line" && (
          <line
            x1={drawing.start[0]}
            y1={drawing.start[1]}
            x2={drawing.end[0]}
            y2={drawing.end[1]}
          />
        )}
        {shape === "path" && (
          <path d={drawing.commands.map((command) => command.join(" ")).join(" ")} />
        )}
        {shape === "text" && (
          <text
            x={0}
            y={drawing.fontSize}
            stroke="none"
            fill={drawing.fill === "none" ? drawing.stroke : drawing.fill}
            fontSize={drawing.fontSize}
            fontFamily="Nunito, sans-serif"
          >
            {drawing.text.split("\n").map((line, i) => (
              <tspan key={i} x={0} dy={i ? drawing.fontSize * 1.2 : 0}>
                {line}
              </tspan>
            ))}
          </text>
        )}
      </g>
    </svg>
  );
}
export function PrimitiveView({ id, data, selected, draggable }: NodeProps<PrimitiveNode>) {
  return (
    <div className={styles.node} data-testid={`primitive-${id}`} data-selected={selected}>
      <NodeResizer
        isVisible={selected && draggable}
        minWidth={12}
        minHeight={12}
        color={data.drawing.stroke}
      />
      <PrimitiveSvg shape={data.shape} drawing={data.drawing} />
    </div>
  );
}
