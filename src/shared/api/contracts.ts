import { z } from "zod";
import { uploadIdSchema } from "../../../packages/pi-live-chat/protocol.js";

export const imageUploadSchema = z.object({
  id: uploadIdSchema,
  path: z.string(),
  url: z.string(),
});

const agentStatusSchema = z.enum(["idle", "working", "blocked", "done", "unknown"]);

export const markAgentReadResponseSchema = z.object({ ok: z.literal(true) });
export const markAgentReadRequestSchema = z.object({
  completionId: z.string().regex(/^[a-f0-9]{64}$/),
});

export const agentSchema = z.object({
  // Fernblick presentation only; agent_status remains Herdr's raw state.
  completion: z.object({ id: z.string().regex(/^[a-f0-9]{64}$/), read: z.boolean() }).optional(),
  terminal_id: z.string().optional(),
  agent: z.string().nullable().optional(),
  agent_status: agentStatusSchema,
  agent_session: z
    .object({
      agent: z.string(),
      kind: z.enum(["id", "path"]),
      source: z.string(),
      value: z.string(),
    })
    .nullable()
    .optional(),
  cwd: z.string().nullable().optional(),
  display_agent: z.string().nullable().optional(),
  focused: z.boolean(),
  foreground_cwd: z.string().nullable().optional(),
  interactive_ready: z.boolean().optional(),
  name: z.string().nullable().optional(),
  pane_id: z.string(),
  revision: z.number(),
  state_change_seq: z.number().optional(),
  tab_id: z.string(),
  tab_label: z.string().optional(),
  terminal_title_stripped: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  workspace_id: z.string(),
  workspace_label: z.string().optional(),
});

export const workspaceSchema = z.object({
  label: z.string(),
  workspace_id: z.string(),
});

export const shellTabSchema = z.object({
  label: z.string(),
  pane_id: z.string(),
  revision: z.number(),
  tab_id: z.string(),
  workspace_id: z.string(),
  workspace_label: z.string().optional(),
});

export const agentsResponseSchema = z.object({
  agents: z.array(agentSchema),
  tabs: z.array(shellTabSchema),
  workspaces: z.array(workspaceSchema),
});

export const optionalAgentNameSchema = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9_-]{0,31}$/, {
      message:
        "Start with a lowercase letter and use only lowercase letters, numbers, dashes, or underscores.",
    })
    .optional(),
);

export const createAgentRequestSchema = z.object({
  name: optionalAgentNameSchema,
  tabLabel: z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    z.string().trim().max(80).optional(),
  ),
  workspaceId: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9:_-]+$/),
});

export const savedChatSchema = z.object({
  id: z.string().regex(/^[a-f0-9]{64}$/),
  title: z.string(),
  preview: z.string(),
  cwd: z.string(),
  updatedAt: z.string().datetime(),
  activePaneId: z.string().nullable(),
});
export const savedChatsResponseSchema = z.object({ chats: z.array(savedChatSchema) });
export const deleteChatResponseSchema = z.object({
  ok: z.literal(true),
  sessionId: z.string().min(1).nullable(),
  boardIds: z.array(z.string().regex(/^[a-f0-9]{64}$/)),
});
export const resumeChatRequestSchema = z.object({
  workspaceId: createAgentRequestSchema.shape.workspaceId,
});
export type SavedChat = z.infer<typeof savedChatSchema>;

export const createAgentResponseSchema = z.object({ agent: agentSchema });

export const createWorkspaceRequestSchema = z.object({
  cwd: z.string().trim().min(1).max(4_096).startsWith("/"),
  label: z.string().trim().min(1).max(80),
});

export const createWorkspaceResponseSchema = z.object({ workspace: workspaceSchema });

export const createTabRequestSchema = z.object({
  label: createAgentRequestSchema.shape.tabLabel,
  workspaceId: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9:_-]+$/),
});

export const createTabResponseSchema = z.object({ tab: shellTabSchema });

export const renameTabRequestSchema = z.object({
  label: z.string().trim().min(1).max(80),
});

export const renameAgentRequestSchema = z.object({
  name: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9_-]{0,31}$/),
});

export const paneInputRequestSchema = z.object({
  text: z.string().trim().min(1).max(32_000),
});

export const terminalReadSourceSchema = z.enum(["visible", "recent_unwrapped"]);
export type TerminalReadSource = z.infer<typeof terminalReadSourceSchema>;

export const terminalOutputSchema = z.object({
  format: z.string(),
  pane_id: z.string(),
  revision: z.number(),
  source: z.string(),
  tab_id: z.string(),
  text: z.string(),
  truncated: z.boolean(),
  workspace_id: z.string(),
});

const keyNameSchema = z.enum([
  "esc",
  "ctrl+c",
  "enter",
  "up",
  "down",
  "left",
  "right",
  "tab",
  "shift+tab",
]);

export const keyRequestSchema = z.object({
  key: keyNameSchema,
});

export type Agent = z.infer<typeof agentSchema>;
export type AgentStatus = z.infer<typeof agentStatusSchema>;
export type CreateAgentRequest = z.infer<typeof createAgentRequestSchema>;
export type CreateWorkspaceRequest = z.infer<typeof createWorkspaceRequestSchema>;
export type CreateTabRequest = z.infer<typeof createTabRequestSchema>;
export type KeyName = z.infer<typeof keyNameSchema>;
export type TerminalOutput = z.infer<typeof terminalOutputSchema>;
export type ShellTab = z.infer<typeof shellTabSchema>;
export type Workspace = z.infer<typeof workspaceSchema>;
