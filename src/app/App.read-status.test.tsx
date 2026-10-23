import { createHash } from "node:crypto";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { App } from "./App";
import { getAgents, markAgentRead } from "../shared/api/apiClient";
import type { Agent } from "../shared/api/contracts";

vi.mock("../shared/api/apiClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../shared/api/apiClient")>()),
  getAgents: vi.fn(),
  markAgentRead: vi.fn(),
}));
vi.mock("./useSinglePaneLayout", () => ({ useSinglePaneLayout: () => true }));
vi.mock("../features/agents/AgentConsole", () => ({
  AgentConsole: ({ onBack }: { onBack: () => void }) => (
    <main>
      <button onClick={onBack}>Back</button>
    </main>
  ),
}));
vi.mock("../features/agents/ShellConsole", () => ({ ShellConsole: () => null }));

const agent: Agent = {
  agent: "pi",
  agent_status: "done",
  focused: false,
  pane_id: "w1:p1",
  tab_id: "w1:t1",
  workspace_id: "w1",
  revision: 7,
  state_change_seq: 12,
  tab_label: "Read my answer",
};
let renderer: ReactTestRenderer;
let client: QueryClient;
let visibility: EventTarget;
let visibilityState: string;
const response = (agents: Agent[]) => ({
  agents: agents.map((item) => ({
    ...item,
    completion:
      item.agent_status === "done"
        ? (item.completion ?? {
            id: createHash("sha256")
              .update(JSON.stringify([item.pane_id, item.agent_session, item.state_change_seq]))
              .digest("hex"),
            read: false,
          })
        : undefined,
  })),
  tabs: [],
  workspaces: [{ workspace_id: "w1", label: "Project" }],
});
const row = (index = 0) => renderer.root.findAllByProps({ "data-testid": "pane-row" })[index];
const status = (index = 0) =>
  row(index)
    .findByProps({ "data-ui": "status-indicator" })
    .children.filter((child) => typeof child === "string")
    .join("");
async function update(agents: Agent[]) {
  await act(async () => {
    client.setQueryData(["agents"], response(agents));
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}
async function openAndBack() {
  await act(async () => row().props.onClick());
  await act(async () =>
    renderer.root
      .findAllByType("button")
      .find((node) => node.children.includes("Back"))!
      .props.onClick(),
  );
}
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  vi.mocked(markAgentRead).mockResolvedValue(undefined);
  visibility = new EventTarget();
  visibilityState = "visible";
  Object.defineProperty(visibility, "visibilityState", { get: () => visibilityState });
  vi.stubGlobal("document", visibility);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(["agents"], response([agent]));
  vi.mocked(getAgents).mockResolvedValue(response([agent]));
  await act(async () => {
    renderer = create(
      <QueryClientProvider client={client}>
        <App />
      </QueryClientProvider>,
    );
  });
});
afterEach(async () => {
  await act(async () => renderer.unmount());
  client.clear();
  vi.unstubAllGlobals();
});

it("clears New answer after opening an agent and going back without replying", async () => {
  expect(status()).toBe("New answer");
  await openAndBack();
  expect(status()).toBe("Idle");
  // Polling the same completion must not resurrect the unread badge.
  await act(async () => {
    client.setQueryData(["agents"], response([{ ...agent, revision: 8 }]));
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  expect(status()).toBe("Idle");
  const workspaceStatus = renderer.root
    .findByProps({ "data-testid": "workspace-disclosure" })
    .findAllByType("summary")[0]!
    .findByProps({ "data-ui": "status-indicator" });
  expect(workspaceStatus.children).toContain("Idle");
  expect(client.getQueryData<ReturnType<typeof response>>(["agents"])!.agents[0].agent_status).toBe(
    "done",
  );
});

it("saves the viewed completion and restores backend receipts after reopening", async () => {
  await openAndBack();
  const completion = response([agent]).agents[0].completion!;
  expect(markAgentRead).toHaveBeenCalledOnce();
  expect(vi.mocked(markAgentRead).mock.calls[0][0]).toEqual({
    paneId: agent.pane_id,
    completionId: completion.id,
  });
  await act(async () => renderer.unmount());
  client.clear();
  client.setQueryData(
    ["agents"],
    response([{ ...agent, completion: { ...completion, read: true } }]),
  );
  await act(async () => {
    renderer = create(
      <QueryClientProvider client={client}>
        <App />
      </QueryClientProvider>,
    );
  });
  expect(status()).toBe("Idle");
  expect(markAgentRead).toHaveBeenCalledTimes(1);
});

it("keeps a failed receipt unread and lets the user retry saving it", async () => {
  vi.mocked(markAgentRead).mockRejectedValueOnce(new Error("Disk unavailable"));
  await openAndBack();
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  expect(status()).toBe("New answer");
  expect(renderer.root.findByProps({ role: "alert" }).findByType("p").children.join(" ")).toContain(
    "Could not save read status",
  );
  await act(async () =>
    renderer.root
      .findAllByType("button")
      .find((node) => node.children.includes("Retry"))!
      .props.onClick(),
  );
  expect(status()).toBe("Idle");
});

it("can retry a failed answer by reopening it after reading a different agent", async () => {
  await update([agent, { ...agent, pane_id: "w1:p2" }]);
  vi.mocked(markAgentRead).mockRejectedValueOnce(new Error("Offline"));
  await openAndBack();
  await act(async () => row(1).props.onClick());
  await act(async () => row().props.onClick());
  expect(status()).toBe("Idle");
  expect(markAgentRead).toHaveBeenCalledTimes(3);
});

it("does not let a delayed acknowledgement clear a newer answer", async () => {
  let finish!: () => void;
  vi.mocked(markAgentRead).mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  await openAndBack();
  expect(status()).toBe("New answer");
  await update([{ ...agent, state_change_seq: 14 }]);
  await act(async () => finish());
  expect(status()).toBe("New answer");
});

it("shows the next completed answer as unread even if polling missed the working state", async () => {
  await openAndBack();
  await update([{ ...agent, state_change_seq: 14, revision: 9 }]);
  expect(status()).toBe("New answer");
  await openAndBack();
  expect(status()).toBe("Idle");
});

it("does not clear another agent's unread answer", async () => {
  await update([agent, { ...agent, pane_id: "w1:p2", tab_id: "w1:t2" }]);
  await act(async () => row().props.onClick());
  expect(status()).toBe("Idle");
  expect(status(1)).toBe("New answer");
});

it.each(["working", "blocked", "unknown", "idle"] as const)(
  "does not override the %s status",
  async (agent_status) => {
    await openAndBack();
    await update([{ ...agent, agent_status, state_change_seq: 13 }]);
    const labels = { working: "Working", blocked: "Needs input", unknown: "Unknown", idle: "Idle" };
    expect(status()).toBe(labels[agent_status]);
  },
);

it("marks answers completed in the open conversation as read", async () => {
  await update([{ ...agent, agent_status: "working", state_change_seq: 13 }]);
  await act(async () => row().props.onClick());
  await update([{ ...agent, state_change_seq: 14 }]);
  expect(status()).toBe("Idle");
});

it("does not mark an answer read in a hidden browser tab", async () => {
  await act(async () => row().props.onClick());
  await act(async () => {
    visibilityState = "hidden";
    visibility.dispatchEvent(new Event("visibilitychange"));
  });
  await update([{ ...agent, state_change_seq: 14 }]);
  expect(status()).toBe("New answer");
  expect(markAgentRead).toHaveBeenCalledTimes(1);
  await act(async () => {
    visibilityState = "visible";
    visibility.dispatchEvent(new Event("visibilitychange"));
  });
  expect(status()).toBe("Idle");
});

it("does not inherit read receipts when a pane hosts a different Pi session", async () => {
  await openAndBack();
  await update([
    {
      ...agent,
      agent_session: { agent: "pi", kind: "path", source: "pi", value: "/sessions/other.jsonl" },
    },
  ]);
  expect(status()).toBe("New answer");
});
