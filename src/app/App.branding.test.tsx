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
vi.mock("../features/agents/AgentList", () => ({ AgentList: () => <nav>Agents</nav> }));
vi.mock("../features/agents/AgentConsole", () => ({ AgentConsole: () => null }));
vi.mock("../features/agents/ShellConsole", () => ({ ShellConsole: () => null }));

const dashboard = { agents: [], tabs: [], workspaces: [] };
let client: QueryClient;
let renderer: ReactTestRenderer;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  client.clear();
  onlineManager.setOnline(true);
  vi.unstubAllGlobals();
});
async function render() {
  await act(async () => {
    renderer = create(
      <QueryClientProvider client={client}>
        <App />
      </QueryClientProvider>,
    );
  });
}
const logo = () => renderer.root.findAllByProps({ src: "/icons/scout-logo.png" });
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 20));

it("shows the full playful logo only while the first dashboard request is pending", async () => {
  let complete!: (value: typeof dashboard) => void;
  vi.mocked(getAgents).mockReturnValue(
    new Promise((resolve) => {
      complete = resolve;
    }),
  );
  await render();
  expect(logo()).toHaveLength(1);
  expect(logo()[0].props.alt).toBe("Fernblick");
  expect(renderer.root.findByProps({ "data-ui": "app-loading" }).props["aria-busy"]).toBe("true");
  await act(async () => {
    complete(dashboard);
    await settle();
  });
  expect(logo()).toHaveLength(0);
  expect(renderer.root.findByType("nav").children).toEqual(["Agents"]);
  const head = renderer.root.findByProps({ src: "/icons/scout-head.png" });
  expect(head.props.alt).toBe("");
  expect(head.props["aria-hidden"]).toBe("true");
});

it("does not hide cached content behind a logo during refetch", async () => {
  client.setQueryData(["agents"], dashboard);
  vi.mocked(getAgents).mockReturnValue(new Promise(() => {}));
  await render();
  expect(logo()).toHaveLength(0);
  expect(renderer.root.findByType("nav").children).toEqual(["Agents"]);
});

it("replaces loading branding with the existing actionable error state", async () => {
  vi.mocked(getAgents).mockRejectedValue(new Error("Test connection failed"));
  await render();
  await act(settle);
  expect(logo()).toHaveLength(0);
  expect(renderer.root.findByType("h1").children).toEqual(["Cannot reach Herdr"]);
  expect(renderer.root.findByType("button").children).toEqual(["Try again"]);
});

it("shows the offline explanation instead of a permanent branded splash", async () => {
  onlineManager.setOnline(false);
  await render();
  expect(logo()).toHaveLength(0);
  expect(getAgents).not.toHaveBeenCalled();
  expect(renderer.root.findByType("h1").children).toEqual(["Fernblick is offline"]);
});
