import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WorkspaceList } from "./AgentOverview";

let renderer: ReactTestRenderer;
const onCreateAgent = vi.fn();
const summary = () => renderer.root.findAllByType("summary")[1]!;
const pointer = (overrides = {}) => ({
  pointerType: "touch",
  button: 0,
  isPrimary: true,
  clientX: 20,
  clientY: 20,
  ...overrides,
});
const click = (detail = 1) => ({ detail, preventDefault: vi.fn(), stopPropagation: vi.fn() });

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  onCreateAgent.mockClear();
  await act(async () => {
    renderer = create(
      <WorkspaceList
        agents={[]}
        tabs={[]}
        workspaces={[
          { workspace_id: "w1", label: "First" },
          { workspace_id: "w2", label: "Empty workspace" },
        ]}
        selectedPaneId={null}
        onSelectAgent={vi.fn()}
        onSelectTab={vi.fn()}
        onCreateAgent={onCreateAgent}
        query=""
      />,
    );
  });
});

afterEach(async () => {
  await act(async () => renderer.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("offers an accessible plus button even in an empty workspace without toggling disclosure", () => {
  const button = renderer.root.findByProps({ "aria-label": "Create agent in Empty workspace" });
  const event = click();
  button.props.onClick(event);
  expect(onCreateAgent).toHaveBeenCalledExactlyOnceWith("w2");
  expect(event.preventDefault).toHaveBeenCalled();
  expect(event.stopPropagation).toHaveBeenCalled();
  const down = { stopPropagation: vi.fn() };
  button.props.onPointerDown(down);
  expect(down.stopPropagation).toHaveBeenCalled();
  vi.advanceTimersByTime(600);
  expect(onCreateAgent).toHaveBeenCalledTimes(1);
});

it.each(["touch", "pen"])(
  "opens creation after a %s long press and suppresses the release click",
  (pointerType) => {
    summary().props.onPointerDown(pointer({ pointerType }));
    vi.advanceTimersByTime(549);
    expect(onCreateAgent).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onCreateAgent).toHaveBeenCalledExactlyOnceWith("w2");
    summary().props.onPointerUp();
    const event = click();
    summary().props.onClick(event);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(event.stopPropagation).toHaveBeenCalled();
  },
);

it("leaves normal taps and keyboard activation to the native disclosure", () => {
  summary().props.onPointerDown(pointer());
  vi.advanceTimersByTime(100);
  summary().props.onPointerUp();
  vi.advanceTimersByTime(600);
  const event = click();
  summary().props.onClick(event);
  expect(event.preventDefault).not.toHaveBeenCalled();
  summary().props.onPointerDown(pointer());
  vi.advanceTimersByTime(550);
  const keyboard = click(0);
  summary().props.onClick(keyboard);
  expect(keyboard.preventDefault).not.toHaveBeenCalled();
});

it.each(["onPointerCancel", "onPointerLeave"])("cancels a pending long press on %s", (handler) => {
  summary().props.onPointerDown(pointer());
  summary().props[handler]();
  vi.advanceTimersByTime(600);
  expect(onCreateAgent).not.toHaveBeenCalled();
});

it("tolerates small pointer jitter but cancels scrolling gestures", () => {
  summary().props.onPointerDown(pointer());
  summary().props.onPointerMove(pointer({ clientX: 23 }));
  vi.advanceTimersByTime(550);
  expect(onCreateAgent).toHaveBeenCalledTimes(1);
  summary().props.onPointerDown(pointer());
  summary().props.onPointerMove(pointer({ clientY: 40 }));
  vi.advanceTimersByTime(600);
  expect(onCreateAgent).toHaveBeenCalledTimes(1);
});

it.each([{ pointerType: "mouse" }, { isPrimary: false }, { button: 2 }])(
  "ignores unsupported pointer presses: %j",
  (overrides) => {
    summary().props.onPointerDown(pointer(overrides));
    vi.advanceTimersByTime(600);
    expect(onCreateAgent).not.toHaveBeenCalled();
  },
);

it("cleans up pending long presses when unmounted", async () => {
  summary().props.onPointerDown(pointer());
  await act(async () => renderer.unmount());
  vi.advanceTimersByTime(600);
  expect(onCreateAgent).not.toHaveBeenCalled();
});
