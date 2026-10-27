import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WorkspaceReorder } from "./WorkspaceReorder";
import { moveWorkspace } from "../../shared/api/apiClient";

vi.mock("../../shared/api/apiClient", () => ({ moveWorkspace: vi.fn() }));
let renderer: ReactTestRenderer;
let client: QueryClient;
const workspaces = ["Alpha", "Beta", "Gamma"].map((label, i) => ({
  workspace_id: `w${i + 1}`,
  label,
}));
const showModal = vi.fn();
const close = vi.fn();
const render = (disabled = false, items = workspaces) => (
  <QueryClientProvider client={client}>
    <WorkspaceReorder workspaces={items} disabled={disabled}>
      {(workspace, handle) => (
        <section>
          <h3>{workspace.label}</h3>
          {handle}
        </section>
      )}
    </WorkspaceReorder>
  </QueryClientProvider>
);
const order = () => renderer.root.findAllByType("h3").map((node) => node.children.join(""));
const context = () =>
  renderer.root.find((node) => !!node.props.onDragEnd && !!node.props.onDragStart);
async function drag(from = "w1", to: string | null = "w3") {
  await act(async () => context().props.onDragStart({ active: { id: from } }));
  await act(async () =>
    context().props.onDragEnd({ active: { id: from }, over: to ? { id: to } : null }),
  );
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.mocked(moveWorkspace).mockReset();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  showModal.mockClear();
  close.mockClear();
  await act(async () => {
    renderer = create(render(), {
      createNodeMock: (element) => (element.type === "dialog" ? { showModal, close } : null),
    });
  });
});
afterEach(async () => {
  await act(async () => renderer.unmount());
  client.clear();
  vi.unstubAllGlobals();
});

it("shows the new order while saving, serializes moves, then reconciles server order", async () => {
  let finish!: () => void;
  vi.mocked(moveWorkspace).mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  vi.spyOn(client, "invalidateQueries").mockImplementation(async () => {
    renderer.update(render(false, [workspaces[1], workspaces[2], workspaces[0]]));
  });
  await drag();
  expect(order()).toEqual(["Beta", "Gamma", "Alpha"]);
  expect(moveWorkspace).toHaveBeenCalledWith({ workspaceId: "w1", beforeWorkspaceId: null });
  await drag("w2", "w3");
  expect(moveWorkspace).toHaveBeenCalledTimes(1);
  await act(async () => finish());
  expect(order()).toEqual(["Beta", "Gamma", "Alpha"]);
  expect(renderer.root.findByType("p").children.join("")).toContain("position 3 of 3");
});

it("rolls back errors and reports them without retrying", async () => {
  vi.mocked(moveWorkspace).mockRejectedValue(new Error("Herdr unavailable"));
  await drag("w3", "w1");
  expect(moveWorkspace).toHaveBeenCalledWith({ workspaceId: "w3", beforeWorkspaceId: "w1" });
  expect(order()).toEqual(["Alpha", "Beta", "Gamma"]);
  expect(renderer.root.findByProps({ role: "alert" }).children.join("")).toContain(
    "Herdr unavailable",
  );
  expect(moveWorkspace).toHaveBeenCalledTimes(1);
});

it("does not consider the rest of the page a drop destination", () => {
  const droppableRects = new Map([["w1", { left: 10, right: 300, top: 100, bottom: 170 }]]);
  for (const pointerCoordinates of [
    { x: 900, y: 120 },
    { x: 20, y: 20 },
    { x: 20, y: 500 },
  ]) {
    expect(context().props.collisionDetection({ pointerCoordinates, droppableRects })).toEqual([]);
  }
});

it("does not save cancelled, outside or unchanged drops", async () => {
  await drag("w1", null);
  await drag("w1", "w1");
  await act(async () => context().props.onDragCancel());
  expect(moveWorkspace).not.toHaveBeenCalled();
});

it("rejects stale drops if another client changes the order", async () => {
  await act(async () => context().props.onDragStart({ active: { id: "w1" } }));
  await act(async () =>
    renderer.update(render(false, [workspaces[1], workspaces[0], workspaces[2]])),
  );
  await act(async () => context().props.onDragEnd({ active: { id: "w1" }, over: { id: "w3" } }));
  expect(moveWorkspace).not.toHaveBeenCalled();
  expect(renderer.root.findByProps({ role: "alert" }).children.join("")).toContain(
    "changed while dragging",
  );
});

it("provides a click-only destination picker without expanding a workspace", async () => {
  const preventDefault = vi.fn();
  const stopPropagation = vi.fn();
  await act(async () =>
    renderer.root
      .findByProps({ "aria-label": "Reorder Gamma" })
      .props.onClick({ preventDefault, stopPropagation }),
  );
  expect(showModal).toHaveBeenCalledOnce();
  expect(preventDefault).toHaveBeenCalledOnce();
  expect(stopPropagation).toHaveBeenCalledOnce();
  await act(async () =>
    renderer.root.findByType("select").props.onChange({ target: { value: "w1" } }),
  );
  await act(async () => renderer.root.findByType("form").props.onSubmit({ preventDefault }));
  expect(moveWorkspace).toHaveBeenCalledWith({ workspaceId: "w3", beforeWorkspaceId: "w1" });
  expect(close).toHaveBeenCalledOnce();
});

it("hides reordering when searching or when only one workspace exists", async () => {
  for (const view of [render(true), render(false, [workspaces[0]])]) {
    await act(async () => renderer.update(view));
    expect(
      renderer.root.findAllByType("button").filter((button) => button.props["aria-haspopup"]),
    ).toHaveLength(0);
  }
});
