// Browser tools use stable semantic hooks, never CSS Modules' generated class names.
export function appSelector(selector) {
  return selector.replaceAll(/\.([a-z][a-z0-9_-]*)/g, (_, name) =>
    name === "output-panel--chat"
      ? '[data-testid="output-panel"][data-view="chat"]'
      : `[data-testid="${name}"]`,
  );
}
