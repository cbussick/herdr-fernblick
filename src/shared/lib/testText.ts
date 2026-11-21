import type { ReactTestInstance } from "react-test-renderer";

/** Read rendered text without stringifying renderer instances as [object Object]. */
export function testText(instance: ReactTestInstance): string {
  return instance.children
    .map((child) => (typeof child === "string" ? child : testText(child)))
    .join("");
}
