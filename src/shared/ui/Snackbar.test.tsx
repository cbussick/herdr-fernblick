import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Snackbar } from "./Snackbar";

let renderer: ReactTestRenderer;
const dismiss = vi.fn();
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  dismiss.mockClear();
  await act(async () => {
    renderer = create(<Snackbar message="Session removed" onDismiss={dismiss} />);
  });
});
afterEach(async () => {
  await act(async () => renderer.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const snackbar = () => renderer.root.findByProps({ "data-testid": "snackbar" });
const advance = (ms: number) =>
  act(async () => {
    vi.advanceTimersByTime(ms);
  });

it("announces the confirmation politely and exposes a dismiss action", () => {
  const status = renderer.root.findByProps({ role: "status" });
  expect(status.children).toEqual(["Session removed"]);
  expect(status.props).toMatchObject({ "aria-live": "polite", "aria-atomic": "true" });
  expect(renderer.root.findByProps({ "aria-label": "Dismiss notification" })).toBeDefined();
});

it("dismisses after six seconds, without being prolonged by parent refreshes", async () => {
  await advance(2_000);
  await act(async () =>
    renderer.update(<Snackbar message="Session removed" onDismiss={dismiss} />),
  );
  await advance(3_999);
  expect(dismiss).not.toHaveBeenCalled();
  await advance(1);
  expect(dismiss).toHaveBeenCalledOnce();
});

it("pauses while hovered or focused and grants a fresh reading interval afterward", async () => {
  await advance(1_000);
  await act(async () => snackbar().props.onMouseEnter());
  await advance(10_000);
  expect(dismiss).not.toHaveBeenCalled();
  await act(async () => snackbar().props.onFocus());
  await act(async () => snackbar().props.onMouseLeave());
  await advance(10_000);
  expect(dismiss).not.toHaveBeenCalled();
  await act(async () =>
    snackbar().props.onBlur({ currentTarget: { contains: () => false }, relatedTarget: null }),
  );
  await advance(5_999);
  expect(dismiss).not.toHaveBeenCalled();
  await advance(1);
  expect(dismiss).toHaveBeenCalledOnce();
});

it("allows manual dismissal", async () => {
  await act(async () =>
    renderer.root.findByProps({ "aria-label": "Dismiss notification" }).props.onClick(),
  );
  expect(dismiss).toHaveBeenCalledOnce();
});

it("clears its timer when unmounted", async () => {
  await act(async () => renderer.unmount());
  await advance(10_000);
  expect(dismiss).not.toHaveBeenCalled();
});
