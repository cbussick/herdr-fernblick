// @vitest-environment happy-dom
import { act, useEffect, useEffectEvent, useState } from "react";
import { create } from "react-test-renderer";
import type { ReactTestRenderer } from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createAppRouter } from "./router";
import { getAgents, getSession, resumeChat } from "../shared/api/apiClient";
import type { Agent } from "../shared/api/contracts";
import { Button } from "../shared/ui";
import { AgentList } from "../features/agents/AgentList";
import { NewAgentDialog } from "../features/agents/NewAgentDialog";

vi.mock("../shared/api/apiClient", async (original) => ({
  ...(await original<typeof import("../shared/api/apiClient")>()),
  getAgents: vi.fn(),
  getSession: vi.fn(),
  resumeChat: vi.fn(),
  markAgentRead: vi.fn(),
}));
vi.mock("./useSinglePaneLayout", () => ({ useSinglePaneLayout: () => true }));
vi.mock("../features/agents/AgentConsole", () => ({
  AgentConsole: ({
    agent,
    onBack,
    onSession,
    onViewChange,
    routeView,
  }: {
    agent: Agent;
    onBack: () => void;
    onSession: (id: string) => void;
    onViewChange: (view: "chat" | "whiteboard", id: string) => void;
    routeView: string;
  }) => {
    const [draft, setDraft] = useState("");
    const id = agent.pane_id === "w1:p1" ? "s1" : "s2";
    const reportSession = useEffectEvent(() => onSession(id));
    useEffect(() => reportSession(), [id]);
    return (
      <main data-testid="chat" data-view={routeView}>
        <input aria-label="Draft" value={draft} onChange={(e) => setDraft(e.target.value)} />
        <button type="button" onClick={onBack}>
          Back to overview
        </button>
        <button type="button" onClick={() => onViewChange("whiteboard", id)}>
          Open board
        </button>
        <button type="button" onClick={() => onViewChange("chat", id)}>
          Close board
        </button>
      </main>
    );
  },
}));
vi.mock("../features/agents/ShellConsole", () => ({
  ShellConsole: () => <main data-testid="shell">Shell</main>,
}));
const agent: Agent = {
  agent: "pi",
  pi_session_id: "s1",
  agent_status: "idle",
  focused: false,
  pane_id: "w1:p1",
  tab_id: "w1:t1",
  workspace_id: "w1",
  revision: 1,
};
const other = { ...agent, pi_session_id: "s2", pane_id: "w1:p2", tab_id: "w1:t2" };
let renderer: ReactTestRenderer;
let client: QueryClient;
let router: ReturnType<typeof createAppRouter>;
const chat = () => renderer.root.findAllByProps({ "data-testid": "chat" });
async function click(label: string) {
  await act(async () =>
    renderer.root
      .findAllByType("button")
      .find((b) => b.children.includes(label))!
      .props.onClick(),
  );
}
async function open(position = 0) {
  await act(async () =>
    renderer.root.findAllByProps({ "data-testid": "pane-row" })[position].props.onClick(),
  );
}
async function start(path = "/") {
  router = createAppRouter(createMemoryHistory({ initialEntries: [path] }));
  await router.load();
  await act(async () => {
    renderer = create(
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
  });
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  const response = {
    agents: [agent, other],
    tabs: [],
    workspaces: [{ workspace_id: "w1", label: "Project" }],
  };
  client.setQueryData(["agents"], response);
  vi.mocked(getAgents).mockResolvedValue(response);
  vi.mocked(getSession).mockImplementation(async (id) => ({
    agent: id === "s1" ? agent : other,
    chat: null,
  }));
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  client.clear();
  vi.unstubAllGlobals();
});

it("opens an agent directly at its session URL without visiting a pane route", async () => {
  await start();
  const visited: Array<string> = [];
  const unsubscribe = router.history.subscribe(() =>
    visited.push(router.history.location.pathname),
  );
  await open();
  unsubscribe();
  expect(visited).toEqual(["/sessions/s1/chat"]);
});

it("opens a fresh agent from its live session even when Herdr has no saved session ID", async () => {
  const starting = { ...agent, pi_session_id: undefined };
  const response = { agents: [starting], tabs: [], workspaces: [] };
  client.setQueryData(["agents"], response);
  vi.mocked(getAgents).mockResolvedValue(response);
  await start();
  const visited: Array<string> = [];
  const unsubscribe = router.history.subscribe(() =>
    visited.push(router.history.location.pathname),
  );
  // Use the flat Agents view because the fixture has no workspaces.
  await act(async () =>
    renderer.root.findByProps({ role: "tab", children: "Agents" }).props.onClick(),
  );
  await open();
  await act(async () => {
    await new Promise((resolve) => {
      setTimeout(resolve, 10);
    });
  });
  expect(chat()).toHaveLength(1);
  expect(JSON.stringify(renderer.toJSON())).not.toContain("Waiting for this agent");
  expect(visited).toEqual([]);
  await act(async () =>
    renderer.root
      .findByProps({ "aria-label": "Draft" })
      .props.onChange({ target: { value: "My first prompt" } }),
  );
  // Pi has an in-memory ID, but session URLs cannot resolve it until it is saved.
  await act(async () => client.setQueryData(["agents"], { ...response, agents: [agent] }));
  await act(async () => {
    await new Promise((resolve) => {
      setTimeout(resolve, 10);
    });
  });
  unsubscribe();
  expect(visited).toEqual(["/sessions/s1/chat"]);
  expect(renderer.root.findByProps({ "aria-label": "Draft" }).props.value).toBe("My first prompt");
});

it("keeps a fresh unsaved conversation and draft when opening its whiteboard", async () => {
  const starting = { ...agent, pi_session_id: undefined };
  const response = { agents: [starting], tabs: [], workspaces: [] };
  client.setQueryData(["agents"], response);
  vi.mocked(getAgents).mockResolvedValue(response);
  vi.mocked(getSession).mockResolvedValue({ agent: null, chat: null });
  await start();
  await act(async () =>
    renderer.root.findByProps({ role: "tab", children: "Agents" }).props.onClick(),
  );
  await open();
  await act(async () =>
    renderer.root
      .findByProps({ "aria-label": "Draft" })
      .props.onChange({ target: { value: "My first prompt" } }),
  );
  await click("Open board");
  await act(async () => {
    await new Promise((resolve) => {
      setTimeout(resolve, 10);
    });
  });
  expect(chat()).toHaveLength(1);
  expect(chat()[0].props["data-view"]).toBe("whiteboard");
  expect(renderer.root.findByProps({ "aria-label": "Draft" }).props.value).toBe("My first prompt");
  expect(getSession).not.toHaveBeenCalled();
  await click("Close board");
  expect(chat()[0].props["data-view"]).toBe("chat");
  expect(renderer.root.findByProps({ "aria-label": "Draft" }).props.value).toBe("My first prompt");
  await click("Open board");
  vi.mocked(getSession).mockResolvedValue({ agent, chat: null });
  await act(async () => client.setQueryData(["agents"], { ...response, agents: [agent] }));
  await act(async () => {
    await new Promise((resolve) => {
      setTimeout(resolve, 10);
    });
  });
  expect(router.state.location.pathname).toBe("/sessions/s1/whiteboard");
  expect(chat()[0].props["data-view"]).toBe("whiteboard");
  expect(renderer.root.findByProps({ "aria-label": "Draft" }).props.value).toBe("My first prompt");
});

it("opens a newly created agent without flashing the waiting snackbar before dashboard refresh", async () => {
  // Hold the refresh so the create response is the only source of the new agent.
  vi.mocked(getAgents).mockImplementation(() => new Promise(() => {}));
  await start();
  await act(async () => renderer.root.findByType(AgentList).props.onCreate());
  const created = { ...other, pane_id: "w1:p3", pi_session_id: undefined };
  await act(async () => renderer.root.findByType(NewAgentDialog).props.onCreated(created));
  expect(JSON.stringify(renderer.toJSON())).not.toContain("Waiting for this agent");
  expect(chat()).toHaveLength(1);
  expect(client.getQueryData<{ agents: Array<Agent> }>(["agents"])?.agents).toContainEqual(created);
});

it("opens a fresh agent while another session is selected and can return to overview", async () => {
  const starting = { ...other, pi_session_id: undefined };
  const response = {
    agents: [agent, starting],
    tabs: [],
    workspaces: [{ workspace_id: "w1", label: "Project" }],
  };
  client.setQueryData(["agents"], response);
  vi.mocked(getAgents).mockResolvedValue(response);
  await start("/sessions/s1/terminal");
  await act(async () => {
    await new Promise((resolve) => {
      setTimeout(resolve, 10);
    });
  });
  await open(1);
  expect(chat()).toHaveLength(1);
  expect(chat()[0].props["data-view"]).toBe("chat");
  expect(JSON.stringify(renderer.toJSON())).not.toContain("Waiting for this agent");
  await click("Open board");
  expect(chat()).toHaveLength(1);
  expect(chat()[0].props["data-view"]).toBe("whiteboard");
  expect(router.state.location.pathname).toBe("/sessions/s1/terminal");
  await click("Back to overview");
  expect(chat()).toHaveLength(0);
  expect(router.state.location.pathname).toBe("/");
});

it.each(["/", "/sessions/s1/chat"])(
  "returns to overview when a pending fresh agent closes from %s",
  async (path) => {
    const starting = { ...other, pi_session_id: undefined };
    const response = {
      agents: [agent, starting],
      tabs: [],
      workspaces: [{ workspace_id: "w1", label: "Project" }],
    };
    client.setQueryData(["agents"], response);
    vi.mocked(getAgents).mockResolvedValue(response);
    await start(path);
    await open(1);
    expect(chat()).toHaveLength(1);

    // The new unsaved agent disappears and the previous URL's conversation is inactive.
    await act(async () => {
      client.setQueryData(["session", "s1"], {
        agent: null,
        chat: { title: "Previous conversation" },
      });
      client.setQueryData(["agents"], { ...response, agents: [] });
      await new Promise((resolve) => {
        setTimeout(resolve, 10);
      });
    });
    expect(JSON.stringify(renderer.toJSON())).not.toContain("Waiting for this agent");
    expect(JSON.stringify(renderer.toJSON())).not.toContain("This conversation is inactive");
    expect(router.state.location.pathname).toBe("/");
    expect(chat()).toHaveLength(0);
  },
);

it("keeps a pending fresh chat mounted when dashboard refresh fails", async () => {
  const starting = { ...agent, pi_session_id: undefined };
  const response = {
    agents: [starting],
    tabs: [],
    workspaces: [{ workspace_id: "w1", label: "Project" }],
  };
  client.setQueryData(["agents"], response);
  vi.mocked(getAgents).mockResolvedValue(response);
  await start();
  await open();
  await act(async () =>
    renderer.root
      .findByProps({ "aria-label": "Draft" })
      .props.onChange({ target: { value: "Keep my draft" } }),
  );
  vi.mocked(getAgents).mockRejectedValue(new Error("Disconnected"));
  await act(async () => {
    await client.refetchQueries({ queryKey: ["agents"] });
  });
  expect(chat()).toHaveLength(1);
  expect(renderer.root.findByProps({ "aria-label": "Draft" }).props.value).toBe("Keep my draft");
});

it("keeps the saved conversation URL when its agent stops externally without showing a waiting banner", async () => {
  await start();
  await open();
  await act(async () => {
    client.setQueryData(["agents"], { agents: [], tabs: [], workspaces: [] });
    client.setQueryData(["session", "s1"], {
      agent: null,
      chat: { title: "Saved conversation" },
    });
    await new Promise((resolve) => {
      setTimeout(resolve, 10);
    });
  });
  expect(router.state.location.pathname).toBe("/sessions/s1/chat");
  expect(JSON.stringify(renderer.toJSON())).toContain("This conversation is inactive");
  expect(JSON.stringify(renderer.toJSON())).not.toContain("Waiting for this agent");
});

it("gives live chats a session URL and restores them with Forward", async () => {
  await start();
  await open();
  expect(router.state.location.pathname).toBe("/sessions/s1/chat");
  await act(async () => router.history.back());
  expect(chat()).toHaveLength(0);
  expect(router.state.location.pathname).toBe("/");
  await act(async () => router.history.forward());
  expect(chat()).toHaveLength(1);
});
it("switching agents keeps one detail entry", async () => {
  await start();
  await open();
  await open(1);
  expect(router.state.location.pathname).toBe("/sessions/s2/chat");
  await click("Back to overview");
  expect(router.state.location.pathname).toBe("/");
});
it("retains a composer draft when switching chat and board", async () => {
  await start();
  await open();
  await act(async () =>
    renderer.root
      .findByProps({ "aria-label": "Draft" })
      .props.onChange({ target: { value: "Keep this draft" } }),
  );
  await click("Open board");
  expect(router.state.location.pathname).toBe("/sessions/s1/whiteboard");
  await act(async () => router.history.back());
  expect(renderer.root.findByProps({ "aria-label": "Draft" }).props.value).toBe("Keep this draft");
});
it("retains the mounted chat and draft when session polling fails", async () => {
  await start();
  await open();
  await act(async () =>
    renderer.root
      .findByProps({ "aria-label": "Draft" })
      .props.onChange({ target: { value: "Still here" } }),
  );
  vi.mocked(getSession).mockRejectedValue(new Error("Temporary failure"));
  await act(async () => {
    await client.refetchQueries({ queryKey: ["session", "s1"] });
    await new Promise((resolve) => {
      setTimeout(resolve, 10);
    });
  });
  expect(renderer.root.findByProps({ "aria-label": "Draft" }).props.value).toBe("Still here");
  expect(JSON.stringify(renderer.toJSON())).toContain("Your draft is retained");
});

it("does not turn a session URL into a shell when its pane is reused", async () => {
  await start();
  await open();
  await act(async () =>
    client.setQueryData(["agents"], {
      agents: [{ ...agent, agent: "other" }],
      tabs: [],
      workspaces: [],
    }),
  );
  expect(chat()).toHaveLength(1);
  expect(renderer.root.findAllByProps({ "data-testid": "shell" })).toHaveLength(0);
});

it("resolves a refreshed session link to its live agent", async () => {
  await start("/sessions/s1/whiteboard");
  await act(async () => {
    await new Promise((r) => {
      setTimeout(r, 10);
    });
  });
  expect(getSession).toHaveBeenCalledWith("s1");
  expect(chat()).toHaveLength(1);
  expect(chat()[0].props["data-view"]).toBe("whiteboard");
});
it("does not resume an inactive conversation just by opening a link", async () => {
  vi.mocked(getSession).mockResolvedValue({
    agent: null,
    chat: {
      id: "a".repeat(64),
      sessionId: "s1",
      title: "Old chat",
      cwd: "/tmp",
      preview: "",
      updatedAt: new Date().toISOString(),
      activePaneId: null,
    },
  });
  await start("/sessions/s1/chat");
  await act(async () => {
    await new Promise((r) => {
      setTimeout(r, 10);
    });
  });
  expect(JSON.stringify(renderer.toJSON())).toContain("This conversation is inactive");
  expect(renderer.root.findByProps({ id: "conversation-state-title" }).children).toEqual([
    "This conversation is inactive",
  ]);
  const actions = renderer.root.findAllByType(Button);
  expect(
    actions.map((button) => [button.props.children, button.props.variant ?? "primary"]),
  ).toEqual([
    ["Resume conversation", "primary"],
    ["Back to overview", "secondary"],
  ]);
  expect(resumeChat).not.toHaveBeenCalled();
  await click("Resume conversation");
  expect(renderer.root.findByProps({ "data-testid": "resume-chat-dialog" })).toBeDefined();
  expect(resumeChat).not.toHaveBeenCalled();
  await click("Cancel");
  await click("Back to overview");
  expect(router.state.location.pathname).toBe("/");
});
it("shows missing conversations without falling back to another pane", async () => {
  vi.mocked(getSession).mockResolvedValue({ agent: null, chat: null });
  await start("/sessions/missing/chat");
  await act(async () => {
    await new Promise((r) => {
      setTimeout(r, 10);
    });
  });
  expect(chat()).toHaveLength(0);
  expect(JSON.stringify(renderer.toJSON())).toContain("Conversation or pane unavailable");
  expect(renderer.root.findAllByType(Button).map((button) => button.props.children)).toEqual([
    "Back to overview",
  ]);
});
it("uses shared primary and secondary buttons for a failed session lookup", async () => {
  vi.mocked(getSession).mockRejectedValue(new Error("Session lookup unavailable"));
  await start("/sessions/s1/chat");
  await act(async () => {
    await new Promise((resolve) => {
      setTimeout(resolve, 10);
    });
  });
  expect(JSON.stringify(renderer.toJSON())).toContain("Cannot open conversation");
  expect(
    renderer.root
      .findAllByType(Button)
      .map((button) => [button.props.children, button.props.variant ?? "primary"]),
  ).toEqual([
    ["Try again", "primary"],
    ["Back to overview", "secondary"],
  ]);
  const requests = vi.mocked(getSession).mock.calls.length;
  await click("Try again");
  expect(vi.mocked(getSession).mock.calls.length).toBeGreaterThan(requests);
});
it("uses pane URLs for shell terminals", async () => {
  const response = {
    agents: [],
    tabs: [{ label: "Shell", pane_id: "w1:p3", tab_id: "w1:t3", workspace_id: "w1", revision: 1 }],
    workspaces: [{ workspace_id: "w1", label: "Project" }],
  };
  client.setQueryData(["agents"], response);
  vi.mocked(getAgents).mockResolvedValue(response);
  await start();
  await open();
  expect(router.state.location.pathname).toBe("/panes/w1%3Ap3/terminal");
  expect(renderer.root.findByProps({ "data-testid": "shell" })).toBeDefined();
});
