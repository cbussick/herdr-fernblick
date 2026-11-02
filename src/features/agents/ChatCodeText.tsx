import { Fragment, useMemo, type ReactNode } from "react";
import { common, createLowlight } from "lowlight";
import styles from "./ChatCodeText.module.css";

const lowlight = createLowlight(common);

// Render tokens as React text, never injected HTML. Ranges stay relative to the
// original source so syntax colors and passage annotations can coexist.
export function ChatCodeText({
  value,
  language,
  renderRange,
}: {
  value: string;
  language?: string;
  renderRange: (start: number, end: number) => ReactNode;
}) {
  const tree = useMemo(() => {
    const name = language?.toLowerCase();
    // No guessing for unlabelled blocks, and bound work on very large responses.
    if (!name || !lowlight.registered(name) || value.length > 50_000) return undefined;
    try {
      return lowlight.highlight(name, value);
    } catch {
      return undefined;
    }
  }, [value, language]);
  if (!tree) return renderRange(0, value.length);

  return renderTree(tree, renderRange);
}

function renderTree(
  tree: ReturnType<typeof lowlight.highlight>,
  renderRange: (start: number, end: number) => ReactNode,
) {
  let offset = 0;
  function render(node: NonNullable<typeof tree>["children"][number], key: number): ReactNode {
    if (node.type === "text") {
      const start = offset;
      offset += node.value.length;
      return <Fragment key={key}>{renderRange(start, offset)}</Fragment>;
    }
    if (node.type !== "element") return null;
    const classes = (node.properties.className as string[] | undefined) ?? [];
    return (
      <span
        key={key}
        className={
          classes
            .map((name) => styles[name.replace(/^hljs-/, "").replaceAll("_", "-")])
            .filter(Boolean)
            .join(" ") || undefined
        }
      >
        {node.children.map(render)}
      </span>
    );
  }
  return tree.children.map(render);
}
