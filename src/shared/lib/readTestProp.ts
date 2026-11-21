import type { ReactTestInstance } from "react-test-renderer";

type ScalarProp = string | number | boolean | null | undefined;

/** Validate scalar observations at the renderer's untyped props boundary. */
export function readTestProp(instance: ReactTestInstance, name: string): ScalarProp {
  const props: unknown = instance.props;
  if (typeof props !== "object" || props === null) {
    throw new TypeError("Test instance has no props object");
  }
  const value: unknown = Object.entries(props).find(([key]) => key === name)?.[1];
  if (
    value === undefined ||
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  throw new TypeError(`Test prop ${name} is not a scalar`);
}
