import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CloseTabButton } from "./CloseTabButton";
import { exitAgentSession } from "../../shared/api/apiClient";
import type { AgentStatus } from "../../shared/api/contracts";

vi.mock("../../shared/api/apiClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../shared/api/apiClient")>()),
  exitAgentSession: vi.fn(),
}));
let renderer: ReactTestRenderer;
let client: QueryClient;
const nativeDialog = { showModal: vi.fn(), close: vi.fn() };
const onClosed = vi.fn();
const button = (label: string) =>
  renderer.root.findAllByType("button").find((node) => node.children.includes(label))!;
async function mount(status: AgentStatus = "idle", agentRunning = true) {
  await act(async () => {
    renderer = create(
      <QueryClientProvider client={client}>
        <CloseTabButton
          agentRunning={agentRunning}
          agentTarget="w1:p1"
          agentStatus={status}
          tabId="w1:t1"
          label="My agent"
          onClosed={onClosed}
        />
      </QueryClientProvider>,
      { createNodeMock: (node) => (node.type === "dialog" ? nativeDialog : null) },
    );
  });
}
async function confirm() {
  await act(async () => renderer.root.findByType("form").props.onSubmit({ preventDefault() {} }));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.mocked(exitAgentSession).mockResolvedValue(undefined);
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  client.clear();
  vi.unstubAllGlobals();
});
it("confirms exit, keeps the tab selected, and refreshes agents and past sessions", async () => {
  await mount();
  const invalidate = vi.spyOn(client, "invalidateQueries");
  await act(async () =>
    renderer.root.findByProps({ "data-testid": "edit-tab-button" }).props.onClick(),
  );
  await act(async () => button("Exit agent session").props.onClick());
  expect(exitAgentSession).not.toHaveBeenCalled();
  expect(JSON.stringify(renderer.toJSON())).toContain(
    "terminal tab will stay open under Shell tabs",
  );
  await confirm();
  expect(exitAgentSession).toHaveBeenCalledExactlyOnceWith("w1:p1");
  expect(nativeDialog.close).toHaveBeenCalledOnce();
  expect(onClosed).not.toHaveBeenCalled();
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ["agents"] });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ["saved-chats"] });
});
it("shows refusal without closing or automatically retrying", async () => {
  await mount();
  vi.mocked(exitAgentSession).mockRejectedValue(new Error("Pi terminal has an unsent draft"));
  await act(async () => button("Exit agent session").props.onClick());
  await confirm();
  expect(renderer.root.findByProps({ role: "alert" }).children).toEqual([
    "Pi terminal has an unsent draft",
  ]);
  expect(exitAgentSession).toHaveBeenCalledOnce();
  expect(nativeDialog.close).not.toHaveBeenCalled();
  expect(onClosed).not.toHaveBeenCalled();
});
it("disables exit while working", async () => {
  await mount("working");
  expect(button("Exit agent session").props.disabled).toBe(true);
});
it("does not offer exit for a shell", async () => {
  await mount("idle", false);
  expect(button("Exit agent session")).toBeUndefined();
});
