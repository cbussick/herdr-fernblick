import { act } from "react";
import { create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { App } from "./App";
import { createAgent, createWorkspace, getAgents } from "../shared/api/apiClient";
import type { Workspace } from "../shared/api/contracts";

vi.mock("../shared/api/apiClient", () => ({
  getAgents: vi.fn(),
  createAgent: vi.fn(),
  createWorkspace: vi.fn(),
}));
vi.mock("./useSinglePaneLayout", () => ({ useSinglePaneLayout: () => false }));
vi.mock("../features/agents/AgentConsole", () => ({ AgentConsole: () => null }));
vi.mock("../features/agents/ShellConsole", () => ({ ShellConsole: () => null }));
vi.mock("../features/agents/AgentList", () => ({
  AgentList: (props: {
    onCreate: (workspaceId?: string) => void;
    onCreateWorkspace: () => void;
    workspaces: Workspace[];
  }) => (
    <nav>
      <button onClick={() => props.onCreate()}>New agent</button>
      <button onClick={props.onCreateWorkspace}>New workspace</button>
      {props.workspaces.map((workspace) => (
        <button key={workspace.workspace_id} onClick={() => props.onCreate(workspace.workspace_id)}>
          {`Add agent to ${workspace.label}`}
        </button>
      ))}
    </nav>
  ),
}));

const existing: Workspace = { workspace_id: "w1", label: "Existing" };
const other: Workspace = { workspace_id: "w3", label: "Other" };
const created: Workspace = { workspace_id: "w2", label: "New project" };
let renderer: ReactTestRenderer;
let client: QueryClient;
const natives = new Map<string, { open: boolean; showModal: () => void; close: () => void }>();

const button = (label: string, root = renderer.root) =>
  root.findAllByType("button").find((node) => node.children.includes(label))!;
const agentForm = () => renderer.root.findByProps({ id: "new-agent-name" }).parent!;
const workspaceForm = () => renderer.root.findByProps({ id: "new-workspace-label" }).parent!;
async function change(id: string, value: string) {
  await act(async () => renderer.root.findByProps({ id }).props.onChange({ target: { value } }));
}
async function click(label: string, root?: ReactTestInstance) {
  await act(async () => button(label, root).props.onClick());
}
async function submit(form: ReactTestInstance) {
  await act(async () => form.props.onSubmit({ preventDefault: vi.fn() }));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}
async function openNestedWorkspace() {
  await click("New agent");
  await change("new-agent-name", "my-agent");
  await change("new-agent-tab", "My tab");
  await click("+ Create a new workspace");
  expect(natives.get("workspace")?.open).toBe(true);
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  natives.clear();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const response = { agents: [], tabs: [], workspaces: [existing, other] };
  client.setQueryData(["agents"], response);
  vi.mocked(getAgents).mockResolvedValue(response);
  vi.mocked(createWorkspace).mockResolvedValue(created);
  vi.mocked(createAgent).mockResolvedValue({
    agent: "pi",
    agent_status: "idle",
    focused: false,
    pane_id: "w2:p1",
    tab_id: "w2:t1",
    workspace_id: "w2",
    revision: 1,
  });
  await act(async () => {
    renderer = create(
      <QueryClientProvider client={client}>
        <App />
      </QueryClientProvider>,
      {
        createNodeMock: (node) => {
          if (node.type !== "dialog") return null;
          const props = node.props as {
            "aria-labelledby"?: string;
            onClose?: (event: { target: unknown; currentTarget: unknown }) => void;
          };
          const native = {
            open: false,
            showModal() {
              this.open = true;
            },
            close() {
              if (!this.open) return;
              this.open = false;
              queueMicrotask(() => props.onClose?.({ target: native, currentTarget: native }));
            },
          };
          natives.set(
            props["aria-labelledby"] === "new-workspace-heading" ? "workspace" : "agent",
            native,
          );
          return native;
        },
      },
    );
  });
});
afterEach(async () => {
  await act(async () => renderer.unmount());
  client.clear();
  vi.unstubAllGlobals();
});

it("returns to the agent draft with the created workspace selected before a list refetch", async () => {
  await openNestedWorkspace();
  // A slow/stale list response must not prevent selecting the workspace just created.
  vi.mocked(getAgents).mockImplementation(() => new Promise(() => {}));
  await change("new-workspace-label", "New project");
  await change("new-workspace-cwd", "/projects/new");
  await submit(workspaceForm());

  expect(createWorkspace).toHaveBeenCalledWith(
    { label: "New project", cwd: "/projects/new" },
    expect.anything(),
  );
  expect(natives.get("agent")?.open).toBe(true);
  expect(renderer.root.findAllByProps({ id: "new-workspace-label" })).toHaveLength(0);
  expect(renderer.root.findByProps({ id: "new-agent-workspace" }).props.value).toBe("w2");
  expect(renderer.root.findByProps({ id: "new-agent-name" }).props.value).toBe("my-agent");
  expect(renderer.root.findByProps({ id: "new-agent-tab" }).props.value).toBe("My tab");
  expect(createAgent).not.toHaveBeenCalled();
  await submit(agentForm());
  expect(createAgent).toHaveBeenCalledWith(
    { name: "my-agent", tabLabel: "My tab", workspaceId: "w2" },
    expect.anything(),
  );
});

it("returns to the unchanged agent draft when workspace creation is canceled", async () => {
  await openNestedWorkspace();
  await click("Cancel", workspaceForm());
  expect(natives.get("agent")?.open).toBe(true);
  expect(renderer.root.findByProps({ id: "new-agent-workspace" }).props.value).toBe("w1");
  expect(renderer.root.findByProps({ id: "new-agent-name" }).props.value).toBe("my-agent");
  expect(createWorkspace).not.toHaveBeenCalled();
  expect(createAgent).not.toHaveBeenCalled();
});

it("opens creation in the requested workspace and submits that workspace", async () => {
  await click("Add agent to Other");
  expect(natives.get("agent")?.open).toBe(true);
  expect(renderer.root.findByProps({ id: "new-agent-workspace" }).props.value).toBe("w3");
  expect(createAgent).not.toHaveBeenCalled();
  await submit(agentForm());
  expect(createAgent).toHaveBeenCalledWith({ workspaceId: "w3" }, expect.anything());
});

it("uses a fresh workspace selection on each open and still allows changing it", async () => {
  await click("Add agent to Other");
  await change("new-agent-workspace", "w1");
  await click("Cancel", agentForm());
  await click("Add agent to Other");
  expect(renderer.root.findByProps({ id: "new-agent-workspace" }).props.value).toBe("w3");
  await click("Cancel", agentForm());
  await click("New agent");
  expect(renderer.root.findByProps({ id: "new-agent-workspace" }).props.value).toBe("w1");
  await change("new-agent-workspace", "w3");
  await submit(agentForm());
  expect(createAgent).toHaveBeenCalledWith({ workspaceId: "w3" }, expect.anything());
});

it("does not open an agent dialog after standalone workspace creation", async () => {
  await click("New workspace");
  await change("new-workspace-label", "New project");
  await change("new-workspace-cwd", "/projects/new");
  await submit(workspaceForm());
  expect(natives.get("agent")?.open).toBeFalsy();
  expect(createAgent).not.toHaveBeenCalled();
});
