import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { onlineManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { App } from "./App";
import { getAgents } from "../shared/api/apiClient";

vi.mock("../shared/api/apiClient", async (original) => ({
  ...(await original<typeof import("../shared/api/apiClient")>()),
  getAgents: vi.fn(),
}));
vi.mock("./useSinglePaneLayout", () => ({ useSinglePaneLayout: () => false }));
vi.mock("../features/agents/AgentList", () => ({
  AgentList: ({ connected }: { connected: boolean }) => (
    <nav data-connected={connected}>Cached overview</nav>
  ),
}));
vi.mock("../features/agents/AgentConsole", () => ({ AgentConsole: () => null }));
vi.mock("../features/agents/ShellConsole", () => ({ ShellConsole: () => null }));

const dashboard = { agents: [], tabs: [], workspaces: [] };
let client: QueryClient;
let renderer: ReactTestRenderer;
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 20));
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  onlineManager.setOnline(true);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(["agents"], dashboard);
  vi.mocked(getAgents).mockResolvedValue(dashboard);
  await act(async () => {
    renderer = create(
      <QueryClientProvider client={client}>
        <App />
      </QueryClientProvider>,
    );
    await settle();
  });
});
afterEach(async () => {
  await act(async () => renderer.unmount());
  client.clear();
  onlineManager.setOnline(true);
  vi.unstubAllGlobals();
});
const connected = () => renderer.root.findByType("nav").props["data-connected"];

it("keeps the last overview on a failed poll, marks it disconnected, and recovers after success", async () => {
  expect(connected()).toBe(true);
  vi.mocked(getAgents).mockRejectedValue(new Error("Cannot reach Herdr"));
  await act(async () => {
    await client.refetchQueries({ queryKey: ["agents"] });
    await settle();
  });
  expect(connected()).toBe(false);
  expect(renderer.root.findByType("nav").children).toEqual(["Cached overview"]);
  expect(renderer.root.findAllByProps({ "data-testid": "page-state" })).toHaveLength(0);

  vi.mocked(getAgents).mockResolvedValue(dashboard);
  await act(async () => {
    await client.refetchQueries({ queryKey: ["agents"] });
    await settle();
  });
  expect(connected()).toBe(true);
});

it("does not claim to be connected while a dashboard poll is paused offline", async () => {
  await act(async () => {
    onlineManager.setOnline(false);
    await client.refetchQueries({ queryKey: ["agents"] });
    await settle();
  });
  expect(connected()).toBe(false);
  await act(async () => {
    onlineManager.setOnline(true);
    await settle();
  });
  expect(connected()).toBe(true);
});
