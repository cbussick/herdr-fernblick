import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import {
  Button,
  FormField,
  SearchField,
  SegmentedTabs,
  SpeedDial,
  StatusIndicator,
  TabKindIcon,
} from ".";
import "./ui.css";

const meta = { title: "UI/Components", parameters: { layout: "centered" } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
export const Buttons: Story = {
  render: () => (
    <div style={{ display: "flex", gap: 12 }}>
      <Button>Primary</Button>
      <Button variant="secondary">Secondary</Button>
      <Button variant="danger">Danger</Button>
    </div>
  ),
};
export const Statuses: Story = {
  render: () => (
    <div style={{ display: "grid", gap: 12 }}>
      {(["blocked", "done", "working", "idle", "unknown"] as const).map((status) => (
        <StatusIndicator
          key={status}
          status={status}
          label={
            {
              blocked: "Needs input",
              done: "New answer",
              working: "Working",
              idle: "Idle",
              unknown: "Unknown",
            }[status]
          }
        />
      ))}
    </div>
  ),
};
export const TabKinds: Story = {
  render: () => (
    <div style={{ display: "flex", gap: 12 }}>
      <TabKindIcon kind="agent" />
      <TabKindIcon kind="shell" />
    </div>
  ),
};
export const OverviewTabs: Story = {
  render: () => (
    <div style={{ width: 320 }}>
      <SegmentedTabs
        label="Overview"
        value="workspaces"
        options={[
          { value: "workspaces", label: "Workspaces" },
          { value: "agents", label: "Agents" },
        ]}
        onChange={fn()}
      />
    </div>
  ),
};
export const Search: Story = {
  render: () => (
    <div style={{ width: 320 }}>
      <SearchField label="Search workspaces" placeholder="Search workspaces" />
    </div>
  ),
};
export const Field: Story = {
  render: () => (
    <div style={{ width: 320 }}>
      <FormField label="Workspace name" help="Choose a recognizable project name.">
        <input placeholder="My project" />
      </FormField>
    </div>
  ),
};
export const CreateSpeedDial: Story = {
  render: () => (
    <div
      style={{
        position: "relative",
        width: 340,
        height: 360,
        border: "1px solid var(--color-border)",
      }}
    >
      <SpeedDial
        actions={[
          {
            id: "agent",
            label: "New Agent",
            description: "Start Pi in a workspace",
            kind: "agent",
            onSelect: fn(),
          },
          {
            id: "shell",
            label: "New Shell Tab",
            description: "Open a regular terminal",
            kind: "shell",
            onSelect: fn(),
          },
          {
            id: "workspace",
            label: "New Workspace",
            description: "Add another project",
            kind: "workspace",
            onSelect: fn(),
          },
        ]}
      />
    </div>
  ),
};
