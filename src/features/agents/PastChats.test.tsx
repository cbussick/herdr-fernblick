import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PastChats } from "./PastChats";
import { getSavedChats, resumeChat } from "../../shared/api/apiClient";
import type { Agent, SavedChat } from "../../shared/api/contracts";
vi.mock("../../shared/api/apiClient", () => ({ getSavedChats: vi.fn(), resumeChat: vi.fn() }));
const chats: SavedChat[] = [
  {
    id: "a".repeat(64),
    title: "Fix authentication",
    preview: "Find the bug",
    cwd: "/projects/web",
    updatedAt: "2026-01-01T12:00:00.000Z",
    activePaneId: null,
  },
  {
    id: "b".repeat(64),
    title: "Release API",
    preview: "Deploy",
    cwd: "/projects/api",
    updatedAt: "2025-12-31T12:00:00.000Z",
    activePaneId: "w1:p2",
  },
];
const agent: Agent = {
  agent: "pi",
  agent_status: "idle",
  focused: false,
  pane_id: "w1:p2",
  tab_id: "w1:t2",
  workspace_id: "w1",
  revision: 1,
};
let renderer: ReactTestRenderer;
let client: QueryClient;
const onResumed = vi.fn();
const onCreateWorkspace = vi.fn();
function view(query = "", withWorkspaces = true) {
  return (
    <QueryClientProvider client={client}>
      <PastChats
        query={query}
        workspaces={
          withWorkspaces
            ? [
                { workspace_id: "w1", label: "Web" },
                { workspace_id: "w2", label: "API" },
              ]
            : []
        }
        onResumed={onResumed}
        onCreateWorkspace={onCreateWorkspace}
      />
    </QueryClientProvider>
  );
}
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  vi.mocked(getSavedChats).mockResolvedValue({ chats });
  vi.mocked(resumeChat).mockResolvedValue(agent);
});
afterEach(async () => {
  if (renderer) await act(async () => renderer.unmount());
  client.clear();
  vi.unstubAllGlobals();
});
const rows = () => renderer.root.findAllByProps({ "data-testid": "saved-chat" });

it("lists chats and filters by project, title and preview", async () => {
  await act(async () => {
    renderer = create(view());
  });
  await settle();
  expect(rows()).toHaveLength(2);
  for (const query of ["authentication", " /projects/web ", "find the bug"]) {
    await act(async () => renderer.update(view(query)));
    expect(rows()).toHaveLength(1);
    expect(rows()[0].findByType("h2").children).toEqual(["Fix authentication"]);
  }
  await act(async () => renderer.update(view("not found")));
  expect(rows()).toHaveLength(0);
  expect(JSON.stringify(renderer.toJSON())).toContain("No chats match your search.");
});

it("resumes in the chosen workspace, disables duplicate actions and selects the returned agent", async () => {
  let complete!: (agent: Agent) => void;
  vi.mocked(resumeChat).mockImplementation(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  await act(async () => {
    renderer = create(view());
  });
  await settle();
  await act(async () =>
    renderer.root.findByType("select").props.onChange({ target: { value: "w2" } }),
  );
  await act(async () => rows()[0].findByType("button").props.onClick());
  await settle();
  expect(resumeChat).toHaveBeenCalledWith(
    { id: chats[0].id, workspaceId: "w2" },
    expect.anything(),
  );
  expect(rows().every((row) => row.findByType("button").props.disabled)).toBe(true);
  await act(async () => complete(agent));
  await settle();
  expect(onResumed).toHaveBeenCalledWith(agent);
});

it("labels running sessions as Open chat and explains how to add a missing workspace", async () => {
  await act(async () => {
    renderer = create(view("", false));
  });
  await settle();
  expect(rows()[0].findByType("button").props.disabled).toBe(true);
  expect(rows()[1].findByType("button").children).toEqual(["Open chat"]);
  const createWorkspace = renderer.root
    .findAllByType("button")
    .find((button) => button.children.includes("Create a workspace to resume chats"))!;
  await act(async () => createWorkspace.props.onClick());
  expect(onCreateWorkspace).toHaveBeenCalledOnce();
});

it("surfaces resume errors without selecting an agent or automatically retrying", async () => {
  vi.mocked(resumeChat).mockRejectedValue(new Error("Project directory unavailable"));
  await act(async () => {
    renderer = create(view());
  });
  await settle();
  await act(async () => rows()[0].findByType("button").props.onClick());
  await settle();
  expect(JSON.stringify(renderer.root.findByProps({ role: "alert" }).children)).toContain(
    "Project directory unavailable",
  );
  expect(onResumed).not.toHaveBeenCalled();
  expect(resumeChat).toHaveBeenCalledOnce();
});

it("offers a retry after a list failure and shows the empty state", async () => {
  vi.mocked(getSavedChats).mockRejectedValueOnce(new Error("Cannot read saved chats"));
  await act(async () => {
    renderer = create(view());
  });
  await settle();
  expect(renderer.root.findByProps({ role: "alert" })).toBeDefined();
  vi.mocked(getSavedChats).mockResolvedValue({ chats: [] });
  const refresh = renderer.root
    .findAllByType("button")
    .find((button) => button.children.includes("Refresh chats"))!;
  await act(async () => refresh.props.onClick());
  await settle();
  expect(JSON.stringify(renderer.toJSON())).toContain("No saved chats yet.");
});
