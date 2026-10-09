import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CloseTabButton } from "./CloseTabButton";

let renderer: ReactTestRenderer;
let queryClient: QueryClient;
const close = vi.fn();
const showModal = vi.fn();
const fetchMock = vi.fn();

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset().mockImplementation(async () => Response.json({ ok: true }));
  close.mockReset();
  showModal.mockReset();
  queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  await act(async () => {
    renderer = create(
      <QueryClientProvider client={queryClient}>
        <CloseTabButton
          agentRunning
          agentName="original-agent"
          agentTarget="w1:p1"
          label="Original tab"
          tabId="w1:t1"
          onClosed={vi.fn()}
        />
      </QueryClientProvider>,
      { createNodeMock: (element) => (element.type === "dialog" ? { close, showModal } : null) },
    );
  });
  await act(async () => {
    renderer.root.findByProps({ "data-testid": "edit-tab-button" }).props.onClick();
    renderer.root.findAllByType("input")[1].props.onChange({ target: { value: "Renamed tab" } });
  });
});

afterEach(async () => {
  await act(async () => renderer.unmount());
  queryClient.clear();
  vi.unstubAllGlobals();
});

it.each([false, true])(
  "closes after one save when renaming the tab (rename agent: %s)",
  async (renameAgent) => {
    if (renameAgent) {
      await act(async () => {
        renderer.root
          .findAllByType("input")[0]
          .props.onChange({ target: { value: "renamed-agent" } });
      });
    }
    await act(async () => {
      renderer.root.findByType("form").props.onSubmit({ preventDefault: vi.fn() });
    });
    await act(async () => {
      await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
    });
    expect(renderer.root.findAllByProps({ role: "alert" })).toHaveLength(0);
    expect(fetchMock).toHaveBeenCalledWith("/api/tabs/w1%3At1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: "Renamed tab" }),
    });
    if (renameAgent) {
      expect(fetchMock).toHaveBeenCalledWith("/api/agents/w1%3Ap1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "renamed-agent" }),
      });
    }
    expect(fetchMock).toHaveBeenCalledTimes(renameAgent ? 2 : 1);
  },
);

it("keeps the dialog open and reports a real rename failure", async () => {
  fetchMock.mockImplementation(async () =>
    Response.json({ error: "Tab not found" }, { status: 502 }),
  );
  await act(async () => {
    renderer.root.findByType("form").props.onSubmit({ preventDefault: vi.fn() });
  });
  await vi.waitFor(async () => {
    await act(async () => {
      await new Promise((done) => setTimeout(done, 0));
    });
    expect(renderer.root.findByProps({ role: "alert" }).children).toEqual(["Tab not found"]);
  });
  expect(close).not.toHaveBeenCalled();
});
