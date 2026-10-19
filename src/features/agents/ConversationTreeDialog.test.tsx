import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readTreePage } from "../../../packages/pi-live-chat/treePage";
import type { TreePageRequest } from "../../../packages/pi-live-chat/treeProtocol";
import { ConversationTreeDialog } from "./ConversationTreeDialog";
const api = vi.hoisted(() => ({ page: vi.fn(), navigate: vi.fn() }));
vi.mock("../../shared/api/apiClient", () => ({
  getAgentTreePage: api.page,
  navigateAgentTree: api.navigate,
}));
const target = {
  runtime: "a0000000-0000-4000-8000-000000000001",
  epoch: "a0000000-0000-4000-8000-000000000002",
  sessionId: "fixture",
};
let manager: SessionManager;
let renderer: ReactTestRenderer;
let client: QueryClient;
const restore = vi.fn<(text: string, attachments: string[]) => void>();
const close = vi.fn<() => void>();
let ids: string[];
const render = (busy = false) => (
  <QueryClientProvider client={client}>
    <ConversationTreeDialog
      open
      target="w1:p1"
      identity={target}
      busy={busy}
      onClose={close}
      onRestorePrompt={restore}
    />
  </QueryClientProvider>
);
async function flush(ms = 20) {
  await act(async () => {
    await new Promise((done) => setTimeout(done, ms));
  });
}
function button(text: string) {
  return renderer.root
    .findAllByType("button")
    .find(
      (node) =>
        node.children
          .filter((child) => typeof child === "string" || typeof child === "number")
          .join("") === text,
    )!;
}
const rows = () => renderer.root.findAllByProps({ "data-testid": "conversation-tree__row" });
async function search(text: string) {
  await act(async () =>
    renderer.root.findByProps({ type: "search" }).props.onChange({ target: { value: text } }),
  );
  await flush(330);
  await flush();
}
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  manager = SessionManager.inMemory();
  ids = [];
  for (let i = 0; i < 354; i++) {
    ids.push(manager.appendMessage({ role: "user", content: `Prompt ${i}`, timestamp: i }));
    for (let j = 0; j < 4; j++) manager.appendCustomEntry("state", {});
  }
  api.page
    .mockReset()
    .mockImplementation(async (_pane, _target, options: TreePageRequest) =>
      readTreePage(manager, options),
    );
  api.navigate.mockReset().mockResolvedValue({
    type: "navigated",
    prompt: { text: "Full restored prompt", attachments: [] },
  });
  restore.mockReset();
  close.mockReset();
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  await act(async () => {
    renderer = create(render());
  });
  await flush();
});
afterEach(async () => {
  await act(async () => renderer.unmount());
  client.clear();
  vi.unstubAllGlobals();
});

it("opens at the current point, keeps the DOM bounded, and pages earlier without navigating", async () => {
  expect(rows()).toHaveLength(50);
  expect(renderer.root.findAllByType("ol")).toHaveLength(1);
  expect(rows()[0].props["data-entry-id"]).toBe(ids[304]);
  expect(renderer.root.findAllByProps({ "aria-current": "location" })).toHaveLength(1);
  await act(async () => button("Load earlier").props.onClick());
  await flush();
  expect(rows()).toHaveLength(50);
  expect(rows()[0].props["data-entry-id"]).toBe(ids[254]);
  expect(button("Continue from here").props.disabled).toBe(true);
  expect(api.navigate).not.toHaveBeenCalled();
});

it("searches unloaded text, clears hidden selection, and restores the full returned prompt, not its preview", async () => {
  await search("Prompt 2");
  expect(rows().length).toBeLessThanOrEqual(50);
  expect(rows()[0].props["data-entry-id"]).toBe(ids[2]);
  expect(button("Continue from here").props.disabled).toBe(true);
  await act(async () => rows()[0].findAllByType("button")[0].props.onClick());
  await act(async () => button("Edit and branch").props.onClick());
  await flush();
  expect(api.navigate).toHaveBeenCalledWith("w1:p1", target, ids[2]);
  expect(restore).toHaveBeenCalledWith("Full restored prompt", []);
  expect(close).toHaveBeenCalledOnce();
});

it("offers actual branch choices and explores an alternate path without invoking navigation", async () => {
  manager.branch(ids[352]);
  const alternate = manager.appendMessage({
    role: "user",
    content: "Alternate ending",
    timestamp: 999,
  });
  await act(async () => button("Refresh paths").props.onClick());
  await flush();
  await act(async () => button("2 branches").props.onClick());
  await flush();
  expect(rows().map((row) => row.props["data-entry-id"])).toEqual([ids[353], alternate]);
  await act(async () =>
    rows()[0]
      .findAllByType("button")
      .find((node) => node.children.includes("View path"))!
      .props.onClick(),
  );
  await flush();
  expect(rows().at(-1)?.props["data-entry-id"]).toBe(ids[353]);
  expect(manager.getLeafId()).toBe(alternate);
  expect(api.navigate).not.toHaveBeenCalled();
});

it("reports a stale page and refreshes without reusing its offset or silently navigating", async () => {
  manager.appendCustomEntry("later-state", {});
  await act(async () => button("Load earlier").props.onClick());
  await flush();
  expect(JSON.stringify(renderer.toJSON())).toContain("Refresh paths to continue");
  expect(button("Continue from here").props.disabled).toBe(true);
  await act(async () => button("Refresh paths").props.onClick());
  await flush();
  expect(rows()).toHaveLength(50);
  expect(rows()[0].props["data-entry-id"]).toBe(ids[304]);
  expect(api.navigate).not.toHaveBeenCalled();
});

it("locks navigation while searching, disconnected/busy, and after a read failure", async () => {
  await act(async () => renderer.update(render(true)));
  expect(button("Edit and branch").props.disabled).toBe(true);
  await act(async () => renderer.update(render(false)));
  await act(async () =>
    renderer.root.findByProps({ type: "search" }).props.onChange({ target: { value: "missing" } }),
  );
  expect(button("Edit and branch").props.disabled).toBe(true);
  await flush(330);
  await flush();
  expect(rows()).toHaveLength(0);
  expect(button("Continue from here").props.disabled).toBe(true);
  expect(api.navigate).not.toHaveBeenCalled();
});

it("does not retry failures and explains the required reload for old extensions", async () => {
  api.page.mockRejectedValueOnce(new Error("Run /reload in Pi to browse large conversation paths"));
  await act(async () => button("Refresh paths").props.onClick());
  await flush();
  expect(JSON.stringify(renderer.toJSON())).toContain("Run /reload");
  expect(api.page).toHaveBeenCalledTimes(2);
  expect(button("Continue from here").props.disabled).toBe(true);
});

it("serializes searches and ignores a late superseded response", async () => {
  let finish!: (page: ReturnType<typeof readTreePage>) => void;
  api.page.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await search("Prompt 2");
  expect(api.page).toHaveBeenCalledTimes(2);
  await search("Prompt 3");
  expect(api.page).toHaveBeenCalledTimes(2);
  expect(button("Edit and branch").props.disabled).toBe(true);
  await act(async () => finish(readTreePage(manager, { query: "Prompt 2" })));
  await flush();
  expect(api.page).toHaveBeenCalledTimes(3);
  expect(rows()[0].props["data-entry-id"]).toBe(ids[3]);
  expect(api.navigate).not.toHaveBeenCalled();
});

it("retains navigation errors, never restores a preview after rejection, and cancels without commands", async () => {
  api.navigate.mockRejectedValueOnce(new Error("Navigation rejected"));
  await act(async () => button("Edit and branch").props.onClick());
  await flush();
  expect(JSON.stringify(renderer.toJSON())).toContain("Navigation rejected");
  expect(restore).not.toHaveBeenCalled();
  expect(close).not.toHaveBeenCalled();
  await act(async () => button("Cancel").props.onClick());
  expect(close).toHaveBeenCalledOnce();
  expect(api.navigate).toHaveBeenCalledOnce();
});
