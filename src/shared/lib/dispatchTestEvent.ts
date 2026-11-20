import type { ReactTestInstance } from "react-test-renderer";

// Like React's own event handler contract, event results are ignored. The driver
// nevertheless awaits asynchronous work so tests observe the completed event.
type TestEventHandler = (...args: ReadonlyArray<unknown>) => void;
function isTestEventHandler(value: unknown): value is TestEventHandler {
  return typeof value === "function";
}
/** Validate the renderer's untyped event boundary before dispatching a test event. */
export async function dispatchTestEvent(
  instance: ReactTestInstance,
  name: string,
  ...args: ReadonlyArray<unknown>
): Promise<void> {
  const props: unknown = instance.props;
  if (typeof props !== "object" || props === null) {
    throw new Error(`Missing test event ${name}`);
  }
  const entry = Object.entries(props).find(([key]) => key === name);
  if (!entry) {
    throw new Error(`Missing test event ${name}`);
  }
  const handler: unknown = entry[1];
  if (!isTestEventHandler(handler)) {
    throw new TypeError(`Test prop ${name} is not callable`);
  }
  await Promise.resolve(handler.call(props, ...args));
}
