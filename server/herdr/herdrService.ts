import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  agentSchema,
  shellTabSchema,
  terminalOutputSchema,
  workspaceSchema,
  type KeyName,
} from "../../src/shared/api/contracts.js";
import { HerdrClient, HerdrRequestError } from "./HerdrClient.js";
import { readPiTranscript } from "../pi/readPiTranscript.js";
import { readPiTree } from "../pi/readPiTree.js";
import { encodeGuardedPrompt } from "../pi/guardedPrompt.js";

const extensionJsPath = fileURLToPath(new URL("../pi/fernblickPiExtension.js", import.meta.url));
const extensionTsPath = fileURLToPath(new URL("../pi/fernblickPiExtension.ts", import.meta.url));
const fernblickExtensionPath = existsSync(extensionJsPath) ? extensionJsPath : extensionTsPath;
const delay = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

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

const agentInfoResultSchema = z.object({
  agent: agentSchema,
  type: z.literal("agent_info"),
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

  async createPiAgent(workspaceId: string, name?: string, tabLabel?: string) {
    const createdTab = await this.client.request(
      "tab.create",
      { workspace_id: workspaceId, ...(tabLabel ? { label: tabLabel } : {}), focus: false },
      tabCreatedResultSchema,
    );
    const agentName =
      name ??
      `pi-${createdTab.root_pane.pane_id.replace(/[^a-z0-9_-]/gi, "-").toLowerCase()}`.slice(0, 32);
    const startedAgent = await this.client.request(
      "agent.start",
      {
        name: agentName,
        kind: "pi",
        pane_id: createdTab.root_pane.pane_id,
        timeout_ms: 30_000,
        args: ["--extension", fernblickExtensionPath],
      },
      agentStartedResultSchema,
    );

    return { ...startedAgent.agent, agent: "pi", tab_label: createdTab.tab.label };
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

  async restartPiAgent(target: string) {
    const { agent } = await this.client.request("agent.get", { target }, agentInfoResultSchema);
    if (agent.agent !== "pi" || agent.agent_session?.kind !== "path") {
      throw new Error("Only Pi agents with a saved session can be restarted");
    }
    if (agent.agent_status !== "idle" && agent.agent_status !== "done") {
      throw new HerdrRequestError(
        "agent_busy",
        "Wait for the agent to finish before restarting it",
      );
    }

    const name =
      agent.name ?? `pi-${agent.pane_id.replace(/[^a-z0-9_-]/gi, "-").toLowerCase()}`.slice(0, 32);
    await this.client.request(
      "pane.send_input",
      { pane_id: agent.pane_id, text: "/quit", keys: ["enter"] },
      okResultSchema,
    );

    const deadline = Date.now() + 10_000;
    let exited = false;
    while (Date.now() < deadline) {
      await delay(100);
      const dashboard = await this.getDashboard();
      if (!dashboard.agents.some((candidate) => candidate.pane_id === agent.pane_id)) {
        exited = true;
        break;
      }
    }
    if (!exited) throw new HerdrRequestError("restart_timeout", "Pi did not exit in time");

    await delay(150);
    const restarted = await this.client.request(
      "agent.start",
      {
        name,
        kind: "pi",
        pane_id: agent.pane_id,
        timeout_ms: 30_000,
        args: ["--session", agent.agent_session.value, "--extension", fernblickExtensionPath],
      },
      agentStartedResultSchema,
    );
    return restarted.agent;
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
    let agent: z.infer<typeof agentSchema>;
    try {
      ({ agent } = await this.client.request("agent.get", { target }, agentInfoResultSchema));
    } catch (error) {
      if (error instanceof HerdrRequestError) {
        return {
          messages: [],
          status: { cwd: "Unknown directory", totalTokens: 0, cost: 0 },
        };
      }
      throw error;
    }
    if (agent.agent && agent.agent !== "pi") {
      throw new Error("A structured transcript is not available for this agent");
    }
    if (agent.agent_session?.kind !== "path") {
      return {
        messages: [],
        status: {
          cwd: agent.foreground_cwd ?? agent.cwd ?? "Unknown directory",
          totalTokens: 0,
          cost: 0,
        },
      };
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

  async readAgentTree(target: string) {
    const { agent } = await this.client.request("agent.get", { target }, agentInfoResultSchema);
    if (agent.agent !== "pi" || agent.agent_session?.kind !== "path") {
      throw new Error("A conversation tree is not available for this agent");
    }
    return readPiTree(agent.agent_session.value);
  }

  async navigateAgentTree(target: string, entryId: string) {
    const tree = await this.readAgentTree(target);
    const containsEntry = (nodes: typeof tree.roots): boolean =>
      nodes.some((node) => node.id === entryId || containsEntry(node.children));
    if (!containsEntry(tree.roots)) throw new Error("Conversation entry was not found");
    // agent.prompt submits text to the model, bypassing Pi's interactive slash-command handler.
    // Deliver the command to the validated agent's pane instead.
    const { agent } = await this.client.request("agent.get", { target }, agentInfoResultSchema);
    if (agent.agent !== "pi" || agent.agent_session?.kind !== "path") {
      throw new Error("A conversation tree is not available for this agent");
    }
    await this.client.request(
      "pane.send_input",
      { pane_id: agent.pane_id, text: `/fernblick-navigate ${entryId}`, keys: ["enter"] },
      okResultSchema,
    );
    return agent;
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

  async promptAgentGuarded(paneId: string, expectedSession: string, id: string, dbPath: string) {
    // agent.prompt bypasses Pi's interactive slash-command handler.
    // Send this guarded command through the same interactive path as tree navigation.
    await this.client.request(
      "pane.send_input",
      {
        pane_id: paneId,
        text: encodeGuardedPrompt({ id, expectedSession, dbPath }),
        keys: ["enter"],
      },
      okResultSchema,
    );
  }

  async sendKey(target: string, key: KeyName) {
    await this.client.request("agent.send_keys", { target, keys: [key] }, okResultSchema);
  }
}
