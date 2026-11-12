import { createContext, useContext, type CSSProperties } from "react";
import { Handle, NodeResizer, Position, type NodeProps } from "@xyflow/react";
import {
  Box,
  Cloud,
  Code,
  Database,
  FileText,
  Globe,
  Heart,
  Image,
  Layout,
  List,
  Lock,
  Mail,
  MessageSquare,
  Pencil,
  Server,
  Settings,
  Table,
  User,
  Users,
  Zap,
  type LucideIcon,
} from "lucide-react";
import type { ComponentData, ComponentNode } from "./model";
import styles from "./Playground.module.css";

export const icons: Record<string, { label: string; component: LucideIcon }> = {
  user: { label: "User", component: User },
  users: { label: "Users", component: Users },
  server: { label: "Server", component: Server },
  database: { label: "Database", component: Database },
  cloud: { label: "Cloud", component: Cloud },
  globe: { label: "Globe", component: Globe },
  lock: { label: "Lock", component: Lock },
  code: { label: "Code", component: Code },
  settings: { label: "Settings", component: Settings },
  zap: { label: "Activity", component: Zap },
  mail: { label: "Mail", component: Mail },
  heart: { label: "Heart", component: Heart },
  box: { label: "Boundary", component: Box },
  layout: { label: "Card", component: Layout },
  list: { label: "Detail", component: List },
  table: { label: "Table", component: Table },
  message: { label: "Comment", component: MessageSquare },
  file: { label: "Document", component: FileText },
  image: { label: "Image", component: Image },
};
export function Icon({ name, size = 24 }: { name: string; size?: number }) {
  const Glyph = icons[name]?.component ?? Box;
  return <Glyph size={size} strokeWidth={1.7} aria-hidden="true" />;
}
export const EditContext = createContext<(id: string) => void>(() => {});

function Picture({ data }: { data: ComponentData }) {
  return data.image ? (
    <img className={styles["node-image"]} src={data.image} alt="" draggable={false} />
  ) : data.icon ? (
    <Icon name={data.icon} />
  ) : null;
}
export function ComponentContent({ data }: { data: ComponentData }) {
  const showPicture = !!(data.image || data.icon);
  if (data.kind === "boundary")
    return (
      <div className={styles["boundary-label"]}>
        {showPicture && <Picture data={data} />}
        <span>{data.title || "Boundary"}</span>
      </div>
    );
  if (data.kind === "icon")
    return (
      <div className={styles["icon-content"]}>
        <div className={styles["icon-tile"]}>{showPicture && <Picture data={data} />}</div>
        <strong>{data.title || "Untitled"}</strong>
        {data.subtitle && <span className={styles["subtitle"]}>{data.subtitle}</span>}
      </div>
    );
  return (
    <>
      <header className={styles["node-heading"]}>
        {showPicture && (data.kind !== "card" || !data.image) && (
          <div className={styles["small-tile"]}>
            <Picture data={data} />
          </div>
        )}
        <div>
          <strong>{data.title || "Untitled"}</strong>
          {data.subtitle && <div className={styles["subtitle"]}>{data.subtitle}</div>}
        </div>
      </header>
      {data.kind === "card" && data.image && (
        <img className={styles["card-image"]} src={data.image} alt="" draggable={false} />
      )}
      {(data.kind === "card" || data.kind === "comment") && data.body && (
        <p className={styles["body"]}>{data.body}</p>
      )}
      {data.kind === "detail" && (
        <div className={styles["detail-fields"]}>
          {data.fields.map((field, index) => (
            <div
              key={index}
              className={field.type === "group" ? styles["group-field"] : styles["detail-field"]}
              style={{ background: field.color || undefined }}
            >
              {field.label && <span className={styles["field-label"]}>{field.label}</span>}
              <span>{field.value || "—"}</span>
            </div>
          ))}
        </div>
      )}
      {data.kind === "table" && (
        <div
          className={`${styles["table-wrap"]} ${styles["no-drag"]} ${styles["no-pan"]} ${styles["no-wheel"]}`}
        >
          <table className={styles["node-table"]}>
            <thead>
              <tr>
                {data.columns.map((column, i) => (
                  <th key={i}>{column || "Column"}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row, i) => (
                <tr key={i}>
                  {row.map((cell, j) => (
                    <td key={j}>{cell || "—"}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
export function componentStyle(data: ComponentData): CSSProperties {
  return { "--accent": data.color } as CSSProperties;
}
export function ComponentView({ id, data, selected }: NodeProps<ComponentNode>) {
  const edit = useContext(EditContext);
  return (
    <div
      className={styles["component"]}
      style={componentStyle(data)}
      data-kind={data.kind}
      data-selected={selected}
      data-testid={`component-${id}`}
    >
      <NodeResizer
        isVisible={selected}
        minWidth={data.kind === "boundary" ? 260 : data.kind === "icon" ? 110 : 220}
        minHeight={data.kind === "boundary" ? 180 : 80}
        color={data.color}
        handleClassName={styles["no-drag"]}
        lineClassName={styles["no-drag"]}
      />
      {[Position.Top, Position.Right, Position.Bottom, Position.Left].map((position) => (
        <Handle
          key={position}
          type="source"
          id={position}
          position={position}
          className={`${styles["handle"]} ${styles["no-drag"]}`}
        />
      ))}
      <ComponentContent data={data} />
      {selected && (
        <button
          className={`${styles["edit-badge"]} ${styles["no-drag"]}`}
          aria-label={`Edit ${data.title || "component"}`}
          onClick={(event) => {
            event.stopPropagation();
            edit(id);
          }}
        >
          <Pencil size={13} /> Edit
        </button>
      )}
    </div>
  );
}
