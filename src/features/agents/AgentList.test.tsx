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
const openSettings = vi.fn();
beforeEach(async () => {
  openSettings.mockClear();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  await act(async () => {
    renderer = create(
      <AgentList
        agents={[]}
        onOpenSettings={openSettings}
        connected
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

it("pairs Scout with the playful wordmark while preserving one accessible Fernblick heading", () => {
  const heading = renderer.root.findByType("h1");
  expect(heading.findByType("span").children).toEqual(["Fernblick"]);
  expect(heading.findByType("span").props.className).toBeTruthy();
  expect(heading.findByType("img").props).toMatchObject({
    src: "/icons/scout-wordmark.png",
    width: 564,
    height: 126,
    alt: "",
    "aria-hidden": "true",
  });
  expect(renderer.root.findAllByProps({ src: "/icons/scout-head.png" })).toHaveLength(1);
  expect(renderer.root.findAllByType("h1")).toHaveLength(1);
});

it("opens app settings from the overview gear without changing the selected overview tab", async () => {
  await click("Past sessions");
  const gear = renderer.root.findByProps({ "aria-label": "Open settings" });
  expect(gear.props["aria-haspopup"]).toBe("dialog");
  await act(async () => gear.props.onClick());
  expect(openSettings).toHaveBeenCalledOnce();
  expect(renderer.root.findByType("input").props["aria-label"]).toBe("Search past sessions");
});

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
  expect(notices()[0].findByProps({ role: "status" }).children).toEqual(["Session removed"]);
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
