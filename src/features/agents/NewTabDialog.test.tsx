import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NewTabDialog } from "./NewTabDialog";
import { createTab } from "../../shared/api/apiClient";

vi.mock("../../shared/api/apiClient", () => ({ createTab: vi.fn() }));
let renderer: ReactTestRenderer;
let client: QueryClient;
const onCreated = vi.fn();
const close = vi.fn();
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  client = new QueryClient();
  vi.mocked(createTab).mockResolvedValue({
    label: "3",
    pane_id: "w1:p3",
    revision: 0,
    tab_id: "w1:t3",
    workspace_id: "w1",
  });
  await act(async () => {
    renderer = create(
      <QueryClientProvider client={client}>
        <NewTabDialog
          workspaces={[{ workspace_id: "w1", label: "Project" }]}
          onCreated={onCreated}
          onClose={vi.fn()}
        />
      </QueryClientProvider>,
      { createNodeMock: (node) => (node.type === "dialog" ? { showModal: vi.fn(), close } : null) },
    );
  });
});
afterEach(async () => {
  await act(async () => renderer.unmount());
  client.clear();
  vi.unstubAllGlobals();
});

it("allows submitting a shell tab without naming it", async () => {
  const input = renderer.root.findByProps({ id: "new-tab-label" });
  expect(input.props.required).not.toBe(true);
  expect(input.props.placeholder).toBe("Next tab number");
  expect(renderer.root.findByProps({ htmlFor: "new-tab-label" }).children).toEqual([
    "Tab name (optional)",
  ]);
  await act(async () =>
    renderer.root.findByType("form").props.onSubmit({ preventDefault: vi.fn() }),
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  expect(createTab).toHaveBeenCalledWith({ label: "", workspaceId: "w1" }, expect.anything());
  expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ label: "3" }));
  expect(close).toHaveBeenCalled();
});
