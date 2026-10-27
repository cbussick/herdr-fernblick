import { existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { SessionCatalog, SavedChatError } from "../pi/sessionCatalog.js";
import type { ChatArtifacts } from "../pi/chatArtifacts.js";
import {
  agentSchema,
  savedChatSchema,
  shellTabSchema,
  terminalOutputSchema,
  workspaceSchema,
  type Agent,
  type KeyName,
  type TerminalReadSource,
} from "../../src/shared/api/contracts.js";
import { getDefaultPiAgentName } from "../../src/shared/agentNaming.js";
import { HerdrClient, HerdrRequestError } from "./HerdrClient.js";

const extensionJsPath = fileURLToPath(
  new URL("../../packages/pi-live-chat/index.js", import.meta.url),
);
const extensionTsPath = fileURLToPath(
  new URL("../../packages/pi-live-chat/index.ts", import.meta.url),
);
const fernblickExtensionPath = existsSync(extensionJsPath) ? extensionJsPath : extensionTsPath;
// Users who installed the standalone package globally can opt out of explicit loading.
const extensionArgs = () =>
  process.env.FERNBLICK_PI_ISOLATED === "1"
    ? [
        "--no-extensions",
        "--extension",
        fernblickExtensionPath,
        ...(process.env.FERNBLICK_HERDR_EXTENSION
          ? ["--extension", process.env.FERNBLICK_HERDR_EXTENSION]
          : []),
      ]
    : process.env.FERNBLICK_PI_GLOBAL === "1"
      ? []
      : ["--extension", fernblickExtensionPath];
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

const tabInfoResultSchema = z.object({
  tab: tabSchema,
  type: z.literal("tab_info"),
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
  private readonly resuming = new Map<string, Promise<Agent>>();
  private readonly restarting = new Set<string>();
  private readonly deleting = new Map<
    string,
    Promise<{ sessionId: string | null; boardIds: string[] }>
  >();
  private cleanupQueue: Promise<void> = Promise.resolve();
  // Herdr can detect a new Pi process before its session-reporting extension catches up.
  private readonly recentlyResumed = new Map<string, { paneId: string; expires: number }>();

  constructor(
    private readonly client: HerdrClient,
    private readonly sessions = new SessionCatalog(),
    private readonly artifacts?: ChatArtifacts,
  ) {}

  async getSavedChats() {
    const [chats, dashboard] = await Promise.all([this.sessions.list(), this.getDashboard()]);
    return {
      chats: chats.map((chat) =>
        savedChatSchema.parse({
          ...chat,
          activePaneId: this.findActiveChat(chat.path, dashboard.agents)?.pane_id ?? null,
        }),
      ),
    };
  }

  private findActiveChat(path: string, agents: Agent[]) {
    for (const [key, value] of this.recentlyResumed)
      if (value.expires <= Date.now()) this.recentlyResumed.delete(key);
    return agents.find(
      (agent) =>
        agent.agent === "pi" &&
        (agent.agent_session?.kind === "path"
          ? resolve(agent.agent_session.value) === path
          : !agent.agent_session && this.recentlyResumed.get(path)?.paneId === agent.pane_id),
    );
  }

  deleteChat(id: string) {
    if (this.resuming.has(id))
      return Promise.reject(
        new SavedChatError(409, "This session is being resumed. Try again later."),
      );
    const pending = this.deleting.get(id);
    if (pending) return pending;
    const operation = this.cleanupQueue.then(() => this.deleteSavedChat(id));
    this.cleanupQueue = operation.then(
      () => undefined,
      () => undefined,
    );
    this.deleting.set(id, operation);
    void operation.finally(() => this.deleting.delete(id)).catch(() => {});
    return operation;
  }

  private async deleteSavedChat(id: string) {
    let chat;
    try {
      chat = await this.sessions.get(id);
    } catch (error) {
      if (error instanceof SavedChatError && error.status === 404) {
        const receipt = await this.sessions.deletionReceipt(id);
        if (receipt) return receipt;
      }
      throw error;
    }
    const dashboard = await this.getDashboard();
    if (this.findActiveChat(chat.path, dashboard.agents))
      throw new SavedChatError(409, "This session is active. Close it before deleting it.");
    if (
      dashboard.agents.some((agent) => agent.agent === "pi" && agent.agent_session?.kind !== "path")
    )
      throw new SavedChatError(
        409,
        "Cannot safely delete while a Pi agent has an unreported session. Wait for it to register or close it.",
      );
    const result = await this.sessions.delete(id, async (current) =>
      this.artifacts
        ? this.artifacts.delete(current, await this.sessions.list(true))
        : { sessionId: current.sessionId, boardIds: [] },
    );
    return result!;
  }

  resumeChat(id: string, workspaceId: string) {
    if (this.deleting.has(id))
      return Promise.reject(
        new SavedChatError(409, "This session is being deleted. Refresh the list."),
      );
    const pending = this.resuming.get(id);
    if (pending) return pending;
    const operation = this.resumeSavedChat(id, workspaceId);
    this.resuming.set(id, operation);
    void operation.finally(() => this.resuming.delete(id)).catch(() => {});
    return operation;
  }

  private async resumeSavedChat(id: string, workspaceId: string) {
    const chat = await this.sessions.get(id);
    const dashboard = await this.getDashboard();
    const active = this.findActiveChat(chat.path, dashboard.agents);
    if (active) return active;
    if (!dashboard.workspaces.some((workspace) => workspace.workspace_id === workspaceId))
      throw new SavedChatError(404, "Workspace no longer exists. Choose another workspace.");
    const directory = await stat(chat.cwd).catch(() => null);
    if (!directory?.isDirectory())
      throw new SavedChatError(
        409,
        "The original project directory is unavailable. Restore it before resuming.",
      );
    const agent = await this.createPiAgent(workspaceId, undefined, chat.title.slice(0, 80), {
      path: chat.path,
      cwd: chat.cwd,
    });
    this.recentlyResumed.set(chat.path, { paneId: agent.pane_id, expires: Date.now() + 30_000 });
    return agent;
  }

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
      // Include every shell pane, including splits beside agents in the same tab.
      tabs: result.snapshot.tabs.flatMap((tab) =>
        result.snapshot.panes
          .filter(
            (pane) =>
              pane.tab_id === tab.tab_id &&
              !result.snapshot.agents.some((agent) => agent.pane_id === pane.pane_id),
          )
          .map((pane) =>
            shellTabSchema.parse({
              label: tab.label,
              pane_id: pane.pane_id,
              revision: pane.revision,
              tab_id: tab.tab_id,
              workspace_id: tab.workspace_id,
              workspace_label: workspaceLabels.get(tab.workspace_id),
            }),
          ),
      ),
    };
  }

  async createPiAgent(
    workspaceId: string,
    name?: string,
    tabLabel?: string,
    session?: { path: string; cwd: string },
  ) {
    const createdTab = await this.client.request(
      "tab.create",
      {
        workspace_id: workspaceId,
        ...(tabLabel ? { label: tabLabel } : {}),
        ...(session ? { cwd: session.cwd } : {}),
        focus: false,
      },
      tabCreatedResultSchema,
    );
    const agentName = name ?? getDefaultPiAgentName(createdTab.root_pane.pane_id);
    const startedAgent = await this.client.request(
      "agent.start",
      {
        name: agentName,
        kind: "pi",
        pane_id: createdTab.root_pane.pane_id,
        timeout_ms: 30_000,
        args: [...(session ? ["--session", session.path] : []), ...extensionArgs()],
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

  async createTab(workspaceId: string, label?: string) {
    const result = await this.client.request(
      "tab.create",
      { workspace_id: workspaceId, ...(label ? { label } : {}), focus: false },
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

  async restartPiAgent(target: string, requestShutdown: (agent: Agent) => Promise<void>) {
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

    if (this.restarting.has(agent.pane_id))
      throw new HerdrRequestError("agent_busy", "A restart is already in progress for this pane");
    this.restarting.add(agent.pane_id);
    try {
      const name = agent.name ?? getDefaultPiAgentName(agent.pane_id);
      // Never type into the terminal: an editor draft would become a user prompt.
      // The live peer validates identity, idle state and editor contents itself.
      await requestShutdown(agent);

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
          args: ["--session", agent.agent_session.value, ...extensionArgs()],
        },
        agentStartedResultSchema,
      );
      return restarted.agent;
    } finally {
      this.restarting.delete(agent.pane_id);
    }
  }

  async renameTab(tabId: string, label: string) {
    await this.client.request("tab.rename", { tab_id: tabId, label }, tabInfoResultSchema);
  }

  async closeTab(tabId: string) {
    await this.client.request("tab.close", { tab_id: tabId }, okResultSchema);
  }

  async readPane(paneId: string, lines: number, source: TerminalReadSource = "visible") {
    if (source === "recent_unwrapped") {
      const dashboard = await this.getDashboard();
      const agent = dashboard.agents.find((candidate) => candidate.pane_id === paneId);
      if (agent) this.requireIdleHistory(agent.agent_status);
    }
    return this.readTerminal("pane.read", { pane_id: paneId }, lines, source);
  }

  private requireIdleHistory(status: string) {
    if (status !== "idle" && status !== "done") {
      throw new HerdrRequestError("agent_busy", "Load history when the agent is idle.");
    }
  }

  private async readTerminal(
    method: "pane.read" | "agent.read",
    target: { pane_id: string } | { target: string },
    lines: number,
    source: TerminalReadSource,
  ) {
    const result = await this.client.request(
      method,
      {
        ...target,
        format: "text",
        strip_ansi: true,
        source,
        ...(source === "recent_unwrapped" ? { lines } : {}),
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

  async getAgent(target: string) {
    const { agent } = await this.client.request("agent.get", { target }, agentInfoResultSchema);
    return agent;
  }

  async readAgent(target: string, lines: number, source: TerminalReadSource = "visible") {
    if (source === "recent_unwrapped") {
      const agent = await this.getAgent(target);
      this.requireIdleHistory(agent.agent_status);
      // Pin the history read to the checked pane, even if the agent is renamed.
      return this.readTerminal("pane.read", { pane_id: agent.pane_id }, lines, source);
    }
    return this.readTerminal("agent.read", { target }, lines, source);
  }

  async sendKey(target: string, key: KeyName) {
    await this.client.request("agent.send_keys", { target, keys: [key] }, okResultSchema);
  }
}
