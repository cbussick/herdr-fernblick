import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import type { Agent, ShellTab, Workspace } from "../../shared/api/contracts";
import { FlatAgentList, WorkspaceList } from "./AgentOverview";
import "../../shared/ui/ui.css";

const workspaces: Workspace[] = [
  { workspace_id: "w1", label: "PHOGET" },
  { workspace_id: "w2", label: "FERNBLICK" },
  { workspace_id: "w3", label: "FEBOP-JOB-SHEET" },
];
const makeAgent = (
  pane_id: string,
  tab_label: string,
  workspace_id: string,
  workspace_label: string,
  agent_status: Agent["agent_status"],
): Agent => ({
  agent: "pi",
  agent_status,
  cwd: `/root/cb-coding/${workspace_label.toLowerCase()}`,
  focused: false,
  pane_id,
  revision: 1,
  tab_id: `${workspace_id}:t1`,
  tab_label,
  workspace_id,
  workspace_label,
});
const agents: Agent[] = [
  makeAgent("w1:p1", "Deployment", "w1", "PHOGET", "blocked"),
  makeAgent("w1:p2", "API research", "w1", "PHOGET", "done"),
  makeAgent("w1:p3", "Performance audit", "w1", "PHOGET", "working"),
  makeAgent("w2:p1", "Ideate UI", "w2", "FERNBLICK", "idle"),
  makeAgent("w3:p1", "GitHub Actions and CI", "w3", "FEBOP-JOB-SHEET", "done"),
];
const tabs: ShellTab[] = [
  { label: "VPS Memory Usage", pane_id: "w1:p4", revision: 1, tab_id: "w1:t4", workspace_id: "w1" },
];
const meta = {
  title: "Overview/Lists",
  parameters: { layout: "centered" },
  decorators: [
    (Story) => (
      <div
        style={{ width: 380, maxWidth: "100vw", padding: 20, background: "var(--color-canvas)" }}
      >
        <Story />
      </div>
    ),
  ],
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
export const Workspaces: Story = {
  render: () => (
    <WorkspaceList
      agents={agents}
      tabs={tabs}
      workspaces={workspaces}
      selectedPaneId={null}
      onSelectAgent={fn()}
      onSelectTab={fn()}
      query=""
    />
  ),
};
export const AgentsAcrossWorkspaces: Story = {
  render: () => <FlatAgentList agents={agents} selectedPaneId={null} onSelect={fn()} query="" />,
};
export const FilteredWorkspaces: Story = {
  render: () => (
    <WorkspaceList
      agents={agents}
      tabs={tabs}
      workspaces={workspaces}
      selectedPaneId={null}
      onSelectAgent={fn()}
      onSelectTab={fn()}
      query="deploy"
    />
  ),
};
