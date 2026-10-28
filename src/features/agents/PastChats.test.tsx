import { act, type ReactElement } from "react";
import { create as render, type ReactTestRenderer } from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PastChats } from "./PastChats";
import { createWorkspace, deleteChat, getSavedChats, resumeChat } from "../../shared/api/apiClient";
import type { Agent, SavedChat, Workspace } from "../../shared/api/contracts";
import { NewWorkspaceDialog } from "./NewWorkspaceDialog";
import { removeWhiteboardDrafts } from "../whiteboard/draftStore";
vi.mock("../whiteboard/draftStore", () => ({ removeWhiteboardDrafts: vi.fn() }));
const deletedChat = { ok: true as const, sessionId: "session", boardIds: ["d".repeat(64)] };
vi.mock("../../shared/api/apiClient", () => ({
  createWorkspace: vi.fn(),
  deleteChat: vi.fn(),
  getSavedChats: vi.fn(),
  resumeChat: vi.fn(),
}));
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
const onRemoved = vi.fn();
const newWorkspace: Workspace = { workspace_id: "w3", label: "web" };
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
  await act(async () =>
    rows()[0]
      .findByProps({ "aria-label": `Resume ${chats[0].title}` })
      .props.onClick(),
  );
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
        onRemoved={onRemoved}
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
  vi.mocked(deleteChat).mockResolvedValue(deletedChat);
  vi.mocked(removeWhiteboardDrafts).mockResolvedValue(undefined);
  vi.mocked(createWorkspace).mockResolvedValue(newWorkspace);
});
afterEach(async () => {
  if (renderer) await act(async () => renderer.unmount());
  client.clear();
  vi.unstubAllGlobals();
});
const rows = () => renderer.root.findAllByProps({ "data-testid": "saved-chat" });
const createWorkspaceButton = () =>
  dialog()
    .findAllByType("button")
    .find((button) => button.children.includes("Create new workspace"))!;
async function openCreation() {
  await act(async () =>
    rows()[0]
      .findByProps({ "aria-label": `Resume ${chats[0].title}` })
      .props.onClick(),
  );
  await act(async () => createWorkspaceButton().props.onClick());
}

it.each([
  ["saved chats", chats],
  ["an empty list", []],
] as const)(
  "shows the shared loading state until the initial request resolves with %s",
  async (_description, result) => {
    let complete!: (value: { chats: SavedChat[] }) => void;
    vi.mocked(getSavedChats).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    await act(async () => {
      renderer = create(view(""));
    });
    const status = renderer.root.findByProps({ role: "status" });
    expect(status.props["aria-busy"]).toBe("true");
    expect(status.findByType("p").children).toEqual(["Loading past sessions…"]);
    expect(status.findByProps({ "data-testid": "empty-state-icon" }).props).toMatchObject({
      "data-state-kind": "loading",
      "data-spinning": true,
    });
    expect(rows()).toHaveLength(0);
    expect(JSON.stringify(renderer.toJSON())).not.toContain("No past sessions yet.");
    await act(async () => complete({ chats: [...result] }));
    await settle();
    expect(renderer.root.findAllByProps({ role: "status" })).toHaveLength(0);
    expect(rows()).toHaveLength(result.length ? 1 : 0);
    if (!result.length)
      expect(JSON.stringify(renderer.toJSON())).toContain("No past sessions yet.");
  },
);

it("shows cards while the backend indexes and avoids a false empty state", async () => {
  vi.mocked(getSavedChats).mockResolvedValue({ chats: [], indexing: true });
  await act(async () => {
    renderer = create(view());
  });
  await settle();
  expect(JSON.stringify(renderer.toJSON())).toContain("Loading past sessions…");
  expect(JSON.stringify(renderer.toJSON())).not.toContain("No past sessions yet.");
  await act(async () => client.setQueryData(["saved-chats"], { chats, indexing: true }));
  await settle();
  expect(rows()).toHaveLength(1);
  expect(JSON.stringify(renderer.toJSON())).toContain("Refreshing past sessions…");
  expect(JSON.stringify(renderer.toJSON())).not.toContain("Loading past sessions…");
  await act(async () => client.setQueryData(["saved-chats"], { chats, indexing: false }));
  await settle();
  expect(renderer.root.findAllByProps({ role: "status" })).toHaveLength(0);
});

it("shows indexing failures without a misleading empty state", async () => {
  vi.mocked(getSavedChats).mockResolvedValue({
    chats: [],
    indexing: false,
    indexError: "Could not refresh saved sessions.",
  });
  await act(async () => {
    renderer = create(view());
  });
  await settle();
  expect(renderer.root.findByProps({ role: "alert" }).children).toEqual([
    "Could not refresh saved sessions.",
  ]);
  expect(JSON.stringify(renderer.toJSON())).not.toContain("No past sessions yet.");
});

it("keeps cached cards visible without a loading placeholder during background refresh", async () => {
  client.setQueryData(["saved-chats"], { chats });
  let complete!: (value: { chats: SavedChat[] }) => void;
  vi.mocked(getSavedChats).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  await act(async () => {
    renderer = create(view());
  });
  expect(getSavedChats).toHaveBeenCalledOnce();
  expect(client.isFetching({ queryKey: ["saved-chats"] })).toBe(1);
  expect(rows()).toHaveLength(1);
  expect(renderer.root.findAllByProps({ role: "status" })).toHaveLength(0);
  await act(async () => complete({ chats }));
  await settle();
  expect(rows()).toHaveLength(1);
  expect(renderer.root.findAllByProps({ role: "status" })).toHaveLength(0);
});

it("lists only closed chats and filters by project, title and preview", async () => {
  await act(async () => {
    renderer = create(view());
  });
  await settle();
  expect(rows()).toHaveLength(1);
  expect(renderer.root.findAllByType("select")).toHaveLength(0);
  expect(renderer.root.findAllByType("dialog")).toHaveLength(0);
  expect(JSON.stringify(renderer.toJSON())).not.toContain("Resume a closed Pi conversation.");
  expect(
    renderer.root
      .findAllByType("button")
      .some(
        (button) =>
          button.children.includes("Refresh chats") || button.children.includes("Try again"),
      ),
  ).toBe(false);
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
  expect(JSON.stringify(renderer.toJSON())).toContain("No sessions match your search.");
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
    rows()[0]
      .findByProps({ "aria-label": `Resume ${chats[0].title}` })
      .props.onClick(),
  );
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
  expect(
    rows().every(
      (row) => row.findByProps({ "aria-label": `Resume ${chats[0].title}` }).props.disabled,
    ),
  ).toBe(true);
  expect(dialog().findByType("select").props.disabled).toBe(true);
  expect(createWorkspaceButton().props.disabled).toBe(true);
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
  expect(rows()[0].findByProps({ "aria-label": `Resume ${chats[0].title}` }).props.disabled).toBe(
    false,
  );
  await act(async () =>
    rows()[0]
      .findByProps({ "aria-label": `Resume ${chats[0].title}` })
      .props.onClick(),
  );
  expect(dialog().findByProps({ type: "submit" }).props.disabled).toBe(true);
  await act(async () => submit());
  expect(resumeChat).not.toHaveBeenCalled();
  await act(async () => createWorkspaceButton().props.onClick());
  expect(dialog().findByType("h2").children).toEqual(["New workspace"]);
  expect(dialog().findByProps({ id: "new-workspace-cwd" }).props.value).toBe(chats[0].cwd);
  expect(createWorkspace).not.toHaveBeenCalled();
  expect(resumeChat).not.toHaveBeenCalled();
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
  expect(JSON.stringify(renderer.toJSON())).toContain("No past sessions yet.");
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
  await act(async () =>
    rows()[0]
      .findByProps({ "aria-label": `Resume ${chats[0].title}` })
      .props.onClick(),
  );
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
  await act(async () =>
    rows()[0]
      .findByProps({ "aria-label": `Resume ${chats[0].title}` })
      .props.onClick(),
  );
  expect(dialog().findAllByProps({ role: "alert" })).toHaveLength(0);
  await act(async () => renderer.update(view("", false)));
  await act(async () => submit());
  expect(resumeChat).toHaveBeenCalledOnce();
});

it.each([true, false])(
  "creates a workspace and returns to the selected chat (existing workspaces: %s)",
  async (existing) => {
    await act(async () => {
      renderer = create(view("", existing));
    });
    await settle();
    await openCreation();
    expect(dialog().findByProps({ id: "new-workspace-label" }).props.value).toBe("web");
    expect(dialog().findByProps({ id: "new-workspace-cwd" }).props.value).toBe("/projects/web");
    await act(async () => submit());
    await settle();
    expect(createWorkspace).toHaveBeenCalledWith(
      { label: "web", cwd: "/projects/web" },
      expect.anything(),
    );
    expect(dialog().findByType("h2").children).toEqual(["Open in which workspace?"]);
    expect(dialog().findByProps({ id: "resume-chat-title" }).children).toEqual([chats[0].title]);
    expect(dialog().findByType("select").props.value).toBe("w3");
    expect(
      dialog()
        .findAllByType("option")
        .filter((option) => option.props.value === "w3"),
    ).toHaveLength(1);
    expect(resumeChat).not.toHaveBeenCalled();
    await act(async () => submit());
    await settle();
    expect(resumeChat).toHaveBeenCalledWith(
      { id: chats[0].id, workspaceId: "w3" },
      expect.anything(),
    );
    expect(createWorkspace).toHaveBeenCalledOnce();
  },
);

it.each(["Cancel", "Close", "Escape"])(
  "returns from creation with %s without losing the chosen workspace or chat",
  async (action) => {
    await act(async () => {
      renderer = create(view());
    });
    await settle();
    await act(async () =>
      rows()[0]
        .findByProps({ "aria-label": `Resume ${chats[0].title}` })
        .props.onClick(),
    );
    await act(async () =>
      dialog()
        .findByType("select")
        .props.onChange({ target: { value: "w2" } }),
    );
    await act(async () => createWorkspaceButton().props.onClick());
    if (action === "Escape")
      await act(async () => dialog().props.onCancel({ preventDefault: vi.fn() }));
    else if (action === "Close")
      await act(async () => dialog().findByProps({ "aria-label": "Close" }).props.onClick());
    else
      await act(async () =>
        dialog()
          .findAllByType("button")
          .find((button) => button.children.includes("Cancel"))!
          .props.onClick(),
      );
    expect(dialog().findByType("select").props.value).toBe("w2");
    expect(dialog().findByProps({ id: "resume-chat-title" }).children).toEqual([chats[0].title]);
    expect(createWorkspace).not.toHaveBeenCalled();
    expect(resumeChat).not.toHaveBeenCalled();
  },
);

it("retains editable defaults and creation errors without automatically retrying or resuming", async () => {
  vi.mocked(createWorkspace).mockRejectedValue(new Error("Directory unavailable"));
  await act(async () => {
    renderer = create(view());
  });
  await settle();
  await openCreation();
  await act(async () =>
    dialog()
      .findByProps({ id: "new-workspace-label" })
      .props.onChange({ target: { value: "Web project" } }),
  );
  await act(async () =>
    dialog()
      .findByProps({ id: "new-workspace-cwd" })
      .props.onChange({ target: { value: "/another/project" } }),
  );
  await act(async () => submit());
  await settle();
  expect(createWorkspace).toHaveBeenCalledWith(
    { label: "Web project", cwd: "/another/project" },
    expect.anything(),
  );
  expect(dialog().findByProps({ role: "alert" }).children).toEqual(["Directory unavailable"]);
  expect(dialog().findByProps({ id: "new-workspace-label" }).props.value).toBe("Web project");
  expect(createWorkspace).toHaveBeenCalledOnce();
  expect(resumeChat).not.toHaveBeenCalled();
});

it("locks creation controls while pending and keeps the created workspace if resume fails", async () => {
  let complete!: (workspace: Workspace) => void;
  vi.mocked(createWorkspace).mockImplementation(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  vi.mocked(resumeChat).mockRejectedValue(new Error("Could not resume"));
  await act(async () => {
    renderer = create(view());
  });
  await settle();
  await openCreation();
  await act(async () => submit());
  await settle();
  expect(
    dialog()
      .findAllByType("input")
      .every((input) => input.props.disabled),
  ).toBe(true);
  expect(
    dialog()
      .findAllByType("button")
      .every((button) => button.props.disabled),
  ).toBe(true);
  await act(async () => submit());
  await act(async () => dialog().props.onCancel({ preventDefault: vi.fn() }));
  expect(createWorkspace).toHaveBeenCalledOnce();
  expect(dialog().findByType("h2").children).toEqual(["New workspace"]);
  await act(async () => complete(newWorkspace));
  await settle();
  await act(async () => submit());
  await settle();
  expect(dialog().findByType("select").props.value).toBe("w3");
  expect(dialog().findByProps({ role: "alert" }).children).toContain("Could not resume");
  expect(createWorkspace).toHaveBeenCalledOnce();
});

it("keeps ordinary workspace creation blank unless initial values are supplied", async () => {
  await act(async () => {
    renderer = create(
      <QueryClientProvider client={client}>
        <NewWorkspaceDialog onClose={vi.fn()} onCreated={vi.fn()} />
      </QueryClientProvider>,
    );
  });
  expect(dialog().findByProps({ id: "new-workspace-label" }).props.value).toBe("");
  expect(dialog().findByProps({ id: "new-workspace-cwd" }).props.value).toBe("");
  expect(createWorkspace).not.toHaveBeenCalled();
});

it("offers a retry after a list failure and shows the empty state", async () => {
  vi.mocked(getSavedChats).mockRejectedValueOnce(new Error("Cannot read saved sessions"));
  await act(async () => {
    renderer = create(view());
  });
  await settle();
  expect(renderer.root.findByProps({ role: "alert" })).toBeDefined();
  expect(renderer.root.findAllByProps({ role: "status" })).toHaveLength(0);
  expect(renderer.root.findAllByProps({ "data-state-kind": "loading" })).toHaveLength(0);
  vi.mocked(getSavedChats).mockResolvedValue({ chats: [] });
  const refresh = renderer.root
    .findAllByType("button")
    .find((button) => button.children.includes("Try again"))!;
  await act(async () => refresh.props.onClick());
  await settle();
  expect(JSON.stringify(renderer.toJSON())).toContain("No past sessions yet.");
});

async function openDelete() {
  await act(async () =>
    rows()[0]
      .findByProps({ "aria-label": `Delete ${chats[0].title}` })
      .props.onClick(),
  );
}

it.each(["Cancel", "Escape"])(
  "dismisses deletion with %s without changing the chat",
  async (action) => {
    await act(async () => {
      renderer = create(view());
    });
    await settle();
    await openDelete();
    expect(dialog().findByType("h2").children).toEqual(["Delete session?"]);
    expect(JSON.stringify(dialog().findByType("p").children)).toContain(chats[0].title);
    expect(deleteChat).not.toHaveBeenCalled();
    if (action === "Escape")
      await act(async () => dialog().props.onCancel({ preventDefault: vi.fn() }));
    else await act(async () => dialog().findByProps({ type: "button" }).props.onClick());
    expect(renderer.root.findAllByType("dialog")).toHaveLength(0);
    expect(rows()).toHaveLength(1);
    expect(deleteChat).not.toHaveBeenCalled();
    expect(onRemoved).not.toHaveBeenCalled();
    expect(resumeChat).not.toHaveBeenCalled();
  },
);

it("waits for confirmed deletion, blocks duplicates and immediately removes the card", async () => {
  let complete!: () => void;
  vi.mocked(deleteChat).mockImplementation(
    () =>
      new Promise((resolve) => {
        complete = () => resolve(deletedChat);
      }),
  );
  await act(async () => {
    renderer = create(view());
  });
  await settle();
  await openDelete();
  await act(async () => submit());
  await settle();
  expect(deleteChat).toHaveBeenCalledWith(chats[0].id, expect.anything());
  expect(
    rows()[0]
      .findAllByType("button")
      .every((button) => button.props.disabled),
  ).toBe(true);
  expect(
    dialog()
      .findAllByType("button")
      .every((button) => button.props.disabled),
  ).toBe(true);
  await act(async () => submit());
  await act(async () => dialog().props.onCancel({ preventDefault: vi.fn() }));
  expect(deleteChat).toHaveBeenCalledOnce();
  expect(onRemoved).not.toHaveBeenCalled();
  expect(renderer.root.findAllByType("dialog")).toHaveLength(1);
  vi.mocked(getSavedChats).mockImplementation(() => new Promise(() => {}));
  await act(async () => complete());
  await settle();
  expect(rows()).toHaveLength(0);
  expect(renderer.root.findAllByType("dialog")).toHaveLength(0);
  expect(client.getQueryData(["saved-chats"])).toEqual({ chats: [chats[1]] });
  expect(removeWhiteboardDrafts).toHaveBeenCalledWith(deletedChat.sessionId, deletedChat.boardIds);
  expect(onRemoved).toHaveBeenCalledOnce();
  expect(onResumed).not.toHaveBeenCalled();
});

it("keeps deletion errors visible, allows retry and clears old errors on reopening", async () => {
  vi.mocked(deleteChat).mockRejectedValueOnce(new Error("This session is active."));
  await act(async () => {
    renderer = create(view());
  });
  await settle();
  await openDelete();
  await act(async () => submit());
  await settle();
  expect(dialog().findByProps({ role: "alert" }).children).toEqual(["This session is active."]);
  expect(rows()).toHaveLength(1);
  expect(deleteChat).toHaveBeenCalledOnce();
  expect(onRemoved).not.toHaveBeenCalled();
  await act(async () => dialog().findByProps({ type: "button" }).props.onClick());
  await openDelete();
  expect(dialog().findAllByProps({ role: "alert" })).toHaveLength(0);
  vi.mocked(getSavedChats).mockResolvedValue({ chats: [chats[1]] });
  await act(async () => submit());
  await settle();
  expect(deleteChat).toHaveBeenCalledTimes(2);
  expect(rows()).toHaveLength(0);
  expect(renderer.root.findAllByType("dialog")).toHaveLength(0);
});

it("warns about local draft cleanup failure without resurrecting a deleted chat", async () => {
  vi.mocked(removeWhiteboardDrafts).mockRejectedValueOnce(new Error("IndexedDB blocked"));
  await act(async () => {
    renderer = create(view());
  });
  await settle();
  await openDelete();
  vi.mocked(getSavedChats).mockResolvedValue({ chats: [chats[1]] });
  await act(async () => submit());
  await settle();
  expect(rows()).toHaveLength(0);
  expect(renderer.root.findAllByType("dialog")).toHaveLength(0);
  expect(JSON.stringify(renderer.root.findByProps({ role: "status" }).children)).toContain(
    "local whiteboard drafts could not be cleared",
  );
});
