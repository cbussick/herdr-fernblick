import { z } from "zod";
import {
  agentSchema,
  shellTabSchema,
  terminalOutputSchema,
  workspaceSchema,
  type KeyName,
} from "../../src/shared/api/contracts.js";
import { HerdrClient } from "./HerdrClient.js";
import { readPiTranscript } from "../pi/readPiTranscript.js";

const tabSchema = z.object({
  label: z.string(),
  tab_id: z.string(),
  workspace_id: z.string(),
});

const sessionSnapshotResultSchema = z.object({
  snapshot: z.object({
    agents: z.array(agentSchema),
    panes: z.array(
      z.object({
        pane_id: z.string(),
        revision: z.number(),
        tab_id: z.string(),
        workspace_id: z.string(),
      }),
    ),
    tabs: z.array(tabSchema),
    workspaces: z.array(workspaceSchema),
  }),
  type: z.literal("session_snapshot"),
});

const agentReadResultSchema = z.object({
  read: terminalOutputSchema,
  type: z.literal("pane_read"),
});

const agentPromptResultSchema = z.object({
  agent: agentSchema,
  type: z.literal("agent_prompted"),
});

const okResultSchema = z.object({ type: z.literal("ok") });

const tabCreatedResultSchema = z.object({
  root_pane: z.object({ pane_id: z.string(), revision: z.number() }),
  tab: tabSchema,
  type: z.literal("tab_created"),
});

const tabRenamedResultSchema = z.object({
  label: z.string(),
  tab_id: z.string(),
  type: z.literal("tab_renamed"),
  workspace_id: z.string(),
});

const agentStartedResultSchema = z.object({
  agent: agentSchema,
  type: z.literal("agent_started"),
});

const workspaceCreatedResultSchema = z.object({
  type: z.literal("workspace_created"),
  workspace: workspaceSchema,
});

export class HerdrService {
  constructor(private readonly client: HerdrClient) {}

  async getDashboard() {
    const result = await this.client.request("session.snapshot", {}, sessionSnapshotResultSchema);
    const tabLabels = new Map(result.snapshot.tabs.map((tab) => [tab.tab_id, tab.label]));
    const workspaceLabels = new Map(
      result.snapshot.workspaces.map((workspace) => [workspace.workspace_id, workspace.label]),
    );

    return {
      agents: result.snapshot.agents.map((agent) => ({
        ...agent,
        tab_label: tabLabels.get(agent.tab_id),
        workspace_label: workspaceLabels.get(agent.workspace_id),
      })),
      workspaces: result.snapshot.workspaces,
      tabs: result.snapshot.tabs.flatMap((tab) => {
        if (result.snapshot.agents.some((agent) => agent.tab_id === tab.tab_id)) return [];
        const pane = result.snapshot.panes.find((candidate) => candidate.tab_id === tab.tab_id);
        return pane
          ? [
              shellTabSchema.parse({
                label: tab.label,
                pane_id: pane.pane_id,
                revision: pane.revision,
                tab_id: tab.tab_id,
                workspace_id: tab.workspace_id,
                workspace_label: workspaceLabels.get(tab.workspace_id),
              }),
            ]
          : [];
      }),
    };
  }

  async createPiAgent(workspaceId: string, name: string, tabLabel: string) {
    const createdTab = await this.client.request(
      "tab.create",
      { workspace_id: workspaceId, label: tabLabel, focus: false },
      tabCreatedResultSchema,
    );
    const startedAgent = await this.client.request(
      "agent.start",
      {
        name,
        kind: "pi",
        pane_id: createdTab.root_pane.pane_id,
        timeout_ms: 30_000,
      },
      agentStartedResultSchema,
    );

    return { ...startedAgent.agent, tab_label: createdTab.tab.label };
  }

  async createWorkspace(label: string, cwd: string) {
    const result = await this.client.request(
      "workspace.create",
      { label, cwd, focus: false },
      workspaceCreatedResultSchema,
    );
    return result.workspace;
  }

  async createTab(workspaceId: string, label: string) {
    const result = await this.client.request(
      "tab.create",
      { workspace_id: workspaceId, label, focus: false },
      tabCreatedResultSchema,
    );
    return shellTabSchema.parse({
      label: result.tab.label,
      pane_id: result.root_pane.pane_id,
      revision: result.root_pane.revision,
      tab_id: result.tab.tab_id,
      workspace_id: result.tab.workspace_id,
    });
  }

  async renameAgent(target: string, name: string) {
    await this.client.request("agent.rename", { target, name }, z.unknown());
  }

  async renameTab(tabId: string, label: string) {
    await this.client.request("tab.rename", { tab_id: tabId, label }, tabRenamedResultSchema);
  }

  async closeTab(tabId: string) {
    await this.client.request("tab.close", { tab_id: tabId }, okResultSchema);
  }

  async readPane(paneId: string, lines: number) {
    const result = await this.client.request(
      "pane.read",
      {
        pane_id: paneId,
        source: "recent_unwrapped",
        format: "text",
        lines,
        strip_ansi: true,
      },
      agentReadResultSchema,
    );
    return result.read;
  }

  async sendPaneInput(paneId: string, text: string) {
    await this.client.request(
      "pane.send_input",
      { pane_id: paneId, text, keys: ["enter"] },
      okResultSchema,
    );
  }

  async sendPaneKey(paneId: string, key: KeyName) {
    await this.client.request("pane.send_keys", { pane_id: paneId, keys: [key] }, okResultSchema);
  }

  async readAgentTranscript(target: string) {
    const dashboard = await this.getDashboard();
    const agent = dashboard.agents.find(
      (candidate) => candidate.name === target || candidate.pane_id === target,
    );
    if (!agent) throw new Error("Agent not found");
    if (agent.agent !== "pi" || agent.agent_session?.kind !== "path") {
      throw new Error("A structured transcript is not available for this agent");
    }
    const [transcript, visible] = await Promise.all([
      readPiTranscript(
        agent.agent_session.value,
        agent.foreground_cwd ?? agent.cwd ?? "Unknown directory",
      ),
      this.client.request(
        "agent.read",
        {
          target,
          source: "visible",
          format: "text",
          strip_ansi: true,
        },
        agentReadResultSchema,
      ),
    ]);
    const visibleLines = visible.read.text.split("\n");
    const footerDivider = visibleLines.findLastIndex((line) => /^\s*[-─]{8,}\s*$/.test(line));
    const renderedFooter = (footerDivider >= 0 ? visibleLines.slice(footerDivider + 1) : [])
      .map((line) => line.trim())
      .filter(Boolean);
    const nativeLines = renderedFooter.some((line) => line.endsWith("...")) ? [] : renderedFooter;
    return { ...transcript, status: { ...transcript.status, nativeLines } };
  }

  async readAgent(target: string, lines: number) {
    const result = await this.client.request(
      "agent.read",
      {
        target,
        source: "recent_unwrapped",
        format: "text",
        lines,
        strip_ansi: true,
      },
      agentReadResultSchema,
    );
    return result.read;
  }

  async promptAgent(target: string, text: string) {
    const result = await this.client.request(
      "agent.prompt",
      { target, text },
      agentPromptResultSchema,
    );
    return result.agent;
  }

  async sendKey(target: string, key: KeyName) {
    await this.client.request("agent.send_keys", { target, keys: [key] }, okResultSchema);
  }
}
