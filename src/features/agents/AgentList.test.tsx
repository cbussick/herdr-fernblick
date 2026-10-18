import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AgentList } from "./AgentList";

vi.mock("./PastChats", () => ({
  PastChats: ({ onRemoved }: { onRemoved: () => void }) => (
    <button type="button" onClick={onRemoved}>
      Remove fixture session
    </button>
  ),
}));
let renderer: ReactTestRenderer;
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  await act(async () => {
    renderer = create(
      <AgentList
        agents={[]}
        tabs={[]}
        workspaces={[]}
        selectedPaneId={null}
        onCreate={vi.fn()}
        onCreateTab={vi.fn()}
        onCreateWorkspace={vi.fn()}
        onSelect={vi.fn()}
        onResumed={vi.fn()}
        onSelectTab={vi.fn()}
      />,
    );
  });
});
afterEach(async () => {
  await act(async () => renderer.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const click = (text: string) =>
  act(async () => {
    renderer.root
      .findAllByType("button")
      .find((button) => button.children.includes(text))!
      .props.onClick();
  });
const notices = () => renderer.root.findAllByProps({ "data-testid": "snackbar" });

it("uses session terminology in the tab and history search", async () => {
  await click("Past sessions");
  expect(renderer.root.findByType("input").props).toMatchObject({
    "aria-label": "Search past sessions",
    placeholder: "Search past sessions",
  });
});

it("shows a removal snackbar across overview tabs and supports manual dismissal", async () => {
  expect(notices()).toHaveLength(0);
  await click("Past sessions");
  await click("Remove fixture session");
  expect(renderer.root.findByProps({ role: "status" }).children).toEqual(["Session removed"]);
  await click("Workspaces");
  expect(notices()).toHaveLength(1);
  await act(async () =>
    renderer.root.findByProps({ "aria-label": "Dismiss notification" }).props.onClick(),
  );
  expect(notices()).toHaveLength(0);
});

it("restarts the confirmation interval for each removed session and then hides it", async () => {
  await click("Past sessions");
  await click("Remove fixture session");
  await act(async () => {
    vi.advanceTimersByTime(4_000);
  });
  await click("Remove fixture session");
  await act(async () => {
    vi.advanceTimersByTime(5_999);
  });
  expect(notices()).toHaveLength(1);
  await act(async () => {
    vi.advanceTimersByTime(1);
  });
  expect(notices()).toHaveLength(0);
});
