import { act, type ReactElement } from "react";
import { create as render, type ReactTestRenderer } from "react-test-renderer";
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
const nativeDialog = {
  open: false,
  showModal: vi.fn(() => {
    nativeDialog.open = true;
  }),
  close: vi.fn(() => {
    nativeDialog.open = false;
  }),
};
function create(element: ReactElement) {
  return render(element, {
    createNodeMock: (node) => (node.type === "dialog" ? nativeDialog : null),
  });
}
const dialog = () => renderer.root.findByType("dialog");
const submit = () => dialog().findByType("form").props.onSubmit({ preventDefault: vi.fn() });
async function openAndConfirm() {
  await act(async () => rows()[0].findByType("button").props.onClick());
  await act(async () => submit());
}
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
  nativeDialog.open = false;
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

it("lists only closed chats and filters by project, title and preview", async () => {
  await act(async () => {
    renderer = create(view());
  });
  await settle();
  expect(rows()).toHaveLength(1);
  expect(renderer.root.findAllByType("select")).toHaveLength(0);
  expect(renderer.root.findAllByType("dialog")).toHaveLength(0);
  expect(JSON.stringify(renderer.toJSON())).not.toContain("Resume a closed Pi conversation.");
  expect(rows()[0].findByType("h2").children).toEqual(["Fix authentication"]);
  for (const query of ["authentication", " /projects/web ", "find the bug"]) {
    await act(async () => renderer.update(view(query)));
    expect(rows()).toHaveLength(1);
    expect(rows()[0].findByType("h2").children).toEqual(["Fix authentication"]);
  }
  await act(async () => renderer.update(view("Release API")));
  expect(rows()).toHaveLength(0);
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
  await act(async () => rows()[0].findByType("button").props.onClick());
  expect(nativeDialog.showModal).toHaveBeenCalledOnce();
  expect(dialog().findByType("h2").children).toEqual(["Open in which workspace?"]);
  expect(dialog().findByProps({ id: "resume-chat-title" }).children).toEqual([
    "Fix authentication",
  ]);
  expect(resumeChat).not.toHaveBeenCalled();
  await act(async () =>
    dialog()
      .findByType("select")
      .props.onChange({ target: { value: "w2" } }),
  );
  await act(async () => submit());
  await settle();
  expect(resumeChat).toHaveBeenCalledWith(
    { id: chats[0].id, workspaceId: "w2" },
    expect.anything(),
  );
  expect(rows().every((row) => row.findByType("button").props.disabled)).toBe(true);
  expect(dialog().findByType("select").props.disabled).toBe(true);
  const preventDefault = vi.fn();
  await act(async () => dialog().props.onCancel({ preventDefault }));
  expect(preventDefault).toHaveBeenCalledOnce();
  expect(renderer.root.findAllByType("dialog")).toHaveLength(1);
  await act(async () => submit());
  expect(resumeChat).toHaveBeenCalledOnce();
  await act(async () => complete(agent));
  await settle();
  expect(onResumed).toHaveBeenCalledWith(agent);
  expect(renderer.root.findAllByType("dialog")).toHaveLength(0);
  expect(nativeDialog.close).toHaveBeenCalledOnce();
});

it("keeps active chats hidden and explains how to add a missing workspace", async () => {
  await act(async () => {
    renderer = create(view("", false));
  });
  await settle();
  expect(rows()).toHaveLength(1);
  expect(rows()[0].findByType("button").props.disabled).toBe(false);
  await act(async () => rows()[0].findByType("button").props.onClick());
  expect(dialog().findByProps({ type: "submit" }).props.disabled).toBe(true);
  await act(async () => submit());
  expect(resumeChat).not.toHaveBeenCalled();
  const createWorkspace = dialog()
    .findAllByType("button")
    .find((button) => button.children.includes("Create a workspace to resume this chat"))!;
  await act(async () => createWorkspace.props.onClick());
  expect(onCreateWorkspace).toHaveBeenCalledOnce();
  expect(renderer.root.findAllByType("dialog")).toHaveLength(0);
});

it("updates visibility when a chat opens or closes between list refreshes", async () => {
  await act(async () => {
    renderer = create(view());
  });
  await settle();
  expect(rows()).toHaveLength(1);
  await act(async () => {
    client.setQueryData(["saved-chats"], {
      chats: chats.map((chat) => ({ ...chat, activePaneId: "w1:p2" })),
    });
  });
  await settle();
  expect(rows()).toHaveLength(0);
  expect(JSON.stringify(renderer.toJSON())).toContain("No past chats yet.");
  await act(async () => {
    client.setQueryData(["saved-chats"], {
      chats: chats.map((chat) => ({ ...chat, activePaneId: null })),
    });
  });
  await settle();
  expect(rows()).toHaveLength(2);
});

it("hides a resumed chat immediately while the next list refresh is pending", async () => {
  await act(async () => {
    renderer = create(view());
  });
  await settle();
  let refreshed!: (value: { chats: SavedChat[] }) => void;
  vi.mocked(getSavedChats).mockImplementation(
    () =>
      new Promise((resolve) => {
        refreshed = resolve;
      }),
  );
  await openAndConfirm();
  await settle();
  expect(onResumed).toHaveBeenCalledWith(agent);
  expect(rows()).toHaveLength(0);
  await act(async () =>
    refreshed({ chats: chats.map((chat) => ({ ...chat, activePaneId: agent.pane_id })) }),
  );
  await settle();
  expect(rows()).toHaveLength(0);
});

it("surfaces resume errors in the dialog without selecting an agent or automatically retrying", async () => {
  vi.mocked(resumeChat).mockRejectedValue(new Error("Project directory unavailable"));
  await act(async () => {
    renderer = create(view());
  });
  await settle();
  await openAndConfirm();
  await settle();
  expect(JSON.stringify(dialog().findByProps({ role: "alert" }).children)).toContain(
    "Project directory unavailable",
  );
  expect(onResumed).not.toHaveBeenCalled();
  expect(resumeChat).toHaveBeenCalledOnce();
});

it.each(["Cancel", "Close", "Escape"])("dismisses with %s without resuming", async (action) => {
  await act(async () => {
    renderer = create(view());
  });
  await settle();
  await act(async () => rows()[0].findByType("button").props.onClick());
  if (action === "Escape") {
    await act(async () => dialog().props.onCancel({ preventDefault: vi.fn() }));
  } else if (action === "Close") {
    await act(async () => dialog().findByProps({ "aria-label": "Close" }).props.onClick());
  } else {
    await act(async () =>
      dialog()
        .findAllByType("button")
        .find((button) => button.children.includes("Cancel"))!
        .props.onClick(),
    );
  }
  expect(renderer.root.findAllByType("dialog")).toHaveLength(0);
  expect(resumeChat).not.toHaveBeenCalled();
  expect(nativeDialog.close).toHaveBeenCalledOnce();
});

it("clears old resume errors on reopening and blocks submission if workspaces disappear", async () => {
  vi.mocked(resumeChat).mockRejectedValue(new Error("Old error"));
  await act(async () => {
    renderer = create(view());
  });
  await settle();
  await openAndConfirm();
  await settle();
  expect(dialog().findAllByProps({ role: "alert" })).toHaveLength(1);
  await act(async () => dialog().findByProps({ "aria-label": "Close" }).props.onClick());
  await act(async () => rows()[0].findByType("button").props.onClick());
  expect(dialog().findAllByProps({ role: "alert" })).toHaveLength(0);
  await act(async () => renderer.update(view("", false)));
  await act(async () => submit());
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
  expect(JSON.stringify(renderer.toJSON())).toContain("No past chats yet.");
});
