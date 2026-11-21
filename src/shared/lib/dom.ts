/** DOM event targets may be non-nodes (Window, AbortSignal, etc.). */
export function isDomNode(target: unknown): target is Node {
  return (
    typeof target === "object" &&
    target !== null &&
    "nodeType" in target &&
    typeof target.nodeType === "number" &&
    "contains" in target &&
    typeof target.contains === "function"
  );
}

export function isDomElement(target: unknown): target is Element {
  return (
    isDomNode(target) &&
    target.nodeType === 1 &&
    "getAttribute" in target &&
    typeof target.getAttribute === "function"
  );
}

/** Namespace check also works for elements from a different window. */
export function isHtmlElement(target: unknown): target is HTMLElement {
  return (
    isDomElement(target) &&
    target.namespaceURI === "http://www.w3.org/1999/xhtml" &&
    "focus" in target &&
    typeof target.focus === "function"
  );
}
