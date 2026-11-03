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

it.each([140, 92, 56, 20, 0])(
  "moves a tall workspace to first position at preview center y=%s",
  async (y) => {
    const rect = (top: number, height: number) => ({
      left: 10,
      right: 300,
      top,
      bottom: top + height,
      width: 290,
      height,
    });
    const droppableRects = new Map([
      ["w1", rect(100, 80)],
      ["w2", rect(200, 800)],
      ["w3", rect(1020, 80)],
    ]);
    const collisions = context().props.collisionDetection({
      active: { id: "w2" },
      pointerCoordinates: { x: 40, y },
      collisionRect: rect(y - 27, 54),
      droppableRects,
      droppableContainers: [...droppableRects.keys()].map((id) => ({ id })),
    });
    vi.spyOn(client, "invalidateQueries").mockImplementation(async () => {
      renderer.update(render(false, [workspaces[1], workspaces[0], workspaces[2]]));
    });
    await drag("w2", collisions[0]?.id ?? null);
    expect(moveWorkspace).toHaveBeenCalledWith({ workspaceId: "w2", beforeWorkspaceId: "w1" });
    expect(order()).toEqual(["Beta", "Alpha", "Gamma"]);
  },
);

it.each([
  [181, "w1"],
  [191, "w1"],
  [192, "w1"],
  [231, "w1"],
  [232, "w2"],
  [233, "w2"],
  [273, "w2"],
  [284, "w2"],
  [323, "w2"],
  [324, "w3"],
])("waits for a lower row's midpoint at preview center y=%s", async (y, target) => {
  const droppableRects = new Map(
    ["w1", "w2", "w3"].map((id, index) => {
      const top = 100 + index * 92;
      return [id, { left: 10, right: 300, top, bottom: top + 80, width: 290, height: 80 }];
    }),
  );
  const collisions = context().props.collisionDetection({
    active: { id: "w1" },
    pointerCoordinates: { x: 40, y },
    collisionRect: { left: 10, right: 300, top: y - 40, bottom: y + 40, width: 290, height: 80 },
    droppableRects,
    droppableContainers: [...droppableRects.keys()].map((id) => ({ id })),
  });
  expect(collisions[0]?.id).toBe(target);
  await drag("w1", collisions[0]?.id ?? null);
  if (target === "w1") expect(moveWorkspace).not.toHaveBeenCalled();
  else
    expect(moveWorkspace).toHaveBeenCalledWith({
      workspaceId: "w1",
      beforeWorkspaceId: target === "w2" ? "w3" : null,
    });
});

it.each([
  [283, "w3"],
  [273, "w3"],
  [272, "w3"],
  [233, "w3"],
  [232, "w2"],
  [231, "w2"],
  [181, "w2"],
  [180, "w2"],
  [141, "w2"],
  [140, "w1"],
])("waits for an upper row's midpoint at preview center y=%s", async (y, target) => {
  const droppableRects = new Map(
    ["w1", "w2", "w3"].map((id, index) => {
      const top = 100 + index * 92;
      return [id, { left: 10, right: 300, top, bottom: top + 80, width: 290, height: 80 }];
    }),
  );
  const collisions = context().props.collisionDetection({
    active: { id: "w3" },
    pointerCoordinates: { x: 40, y },
    collisionRect: { left: 10, right: 300, top: y - 40, bottom: y + 40, width: 290, height: 80 },
    droppableRects,
    droppableContainers: [...droppableRects.keys()].map((id) => ({ id })),
  });
  expect(collisions[0]?.id).toBe(target);
  await drag("w3", collisions[0]?.id ?? null);
  if (target === "w3") expect(moveWorkspace).not.toHaveBeenCalled();
  else expect(moveWorkspace).toHaveBeenCalledWith({ workspaceId: "w3", beforeWorkspaceId: target });
});

it.each([
  ["w1", 231, 260, "w1"],
  ["w1", 232, 200, "w2"],
  ["w1", 233, 200, "w2"],
  ["w3", 233, 210, "w3"],
  ["w3", 232, 260, "w2"],
  ["w3", 231, 260, "w2"],
])(
  "uses the dragged preview center for %s at center=%s and pointer=%s",
  async (from, center, pointer, target) => {
    const droppableRects = new Map(
      ["w1", "w2", "w3"].map((id, index) => {
        const top = 100 + index * 92;
        return [id, { left: 10, right: 300, top, bottom: top + 80, width: 290, height: 80 }];
      }),
    );
    const collisions = context().props.collisionDetection({
      active: { id: from },
      pointerCoordinates: { x: 40, y: pointer },
      collisionRect: {
        left: 10,
        right: 250,
        width: 240,
        top: center - 27,
        bottom: center + 27,
        height: 54,
      },
      droppableRects,
      droppableContainers: [...droppableRects.keys()].map((id) => ({ id })),
    });
    expect(collisions[0]?.id).toBe(target);
    await drag(from, collisions[0]?.id ?? null);
    if (target === from) expect(moveWorkspace).not.toHaveBeenCalled();
    else
      expect(moveWorkspace).toHaveBeenCalledWith({
        workspaceId: from,
        beforeWorkspaceId: from === "w1" ? "w3" : "w2",
      });
  },
);

it("targets expanded rows, keeps gaps droppable and preserves keyboard detection", () => {
  const droppableRects = new Map([
    ["w1", { left: 10, right: 300, top: 100, bottom: 900, width: 290, height: 800 }],
    ["w2", { left: 10, right: 300, top: 920, bottom: 1000, width: 290, height: 80 }],
  ]);
  const args = {
    active: { id: "w2" },
    collisionRect: { left: 10, right: 300, top: 920, bottom: 1000, width: 290, height: 80 },
    droppableRects,
    droppableContainers: [...droppableRects.keys()].map((id) => ({ id })),
  };
  const collisionDetection = context().props.collisionDetection;
  const atCenter = (center: number) =>
    collisionDetection({
      ...args,
      pointerCoordinates: { x: 40, y: 960 },
      collisionRect: { ...args.collisionRect, top: center - 27, bottom: center + 27, height: 54 },
    })[0].id;
  // An expanded row also requires the preview center to cross its midpoint.
  expect(atCenter(890)).toBe("w2");
  expect(atCenter(500)).toBe("w1");
  expect(atCenter(910)).toBe("w2");
  expect(atCenter(1044)).toBe("w2");
  expect(collisionDetection(args)[0].id).toBe("w2");
});

it("does not consider the rest of the page a drop destination", () => {
  const droppableRects = new Map([["w1", { left: 10, right: 300, top: 100, bottom: 170 }]]);
  for (const pointerCoordinates of [
    { x: 900, y: 120 },
    { x: 20, y: -1 },
    { x: 20, y: 215 },
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
