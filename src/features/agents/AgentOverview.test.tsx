import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WorkspaceList } from "./AgentOverview";

let renderer: ReactTestRenderer;
const onCreateAgent = vi.fn();
const summary = () => renderer.root.findAllByType("summary")[1]!;

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

it.each([
  ["First", "w1"],
  ["Empty workspace", "w2"],
])("keeps the plus button for %s without toggling disclosure", (label, workspaceId) => {
  const button = renderer.root.findByProps({ "aria-label": `Create agent in ${label}` });
  const event = { preventDefault: vi.fn(), stopPropagation: vi.fn() };
  button.props.onClick(event);
  expect(onCreateAgent).toHaveBeenCalledExactlyOnceWith(workspaceId);
  expect(event.preventDefault).toHaveBeenCalled();
  expect(event.stopPropagation).toHaveBeenCalled();
});

it.each(["touch", "pen"])(
  "does not create an agent when holding a workspace with %s",
  (pointerType) => {
    const header = summary();
    header.props.onPointerDown?.({
      pointerType,
      button: 0,
      isPrimary: true,
      clientX: 20,
      clientY: 20,
    });
    vi.advanceTimersByTime(2_000);
    header.props.onPointerUp?.();
    expect(onCreateAgent).not.toHaveBeenCalled();
    expect(header.props.onPointerDown).toBeUndefined();
  },
);

it("leaves workspace clicks, keyboard activation and context menus to the browser", () => {
  const header = summary();
  expect(header.props.onClick).toBeUndefined();
  expect(header.props.onKeyDown).toBeUndefined();
  expect(header.props.onContextMenu).toBeUndefined();
});
