import { z } from "zod";

export const agentStatusSchema = z.enum(["idle", "working", "blocked", "done", "unknown"]);

export const agentSchema = z.object({
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

export const createAgentResponseSchema = z.object({ agent: agentSchema });

export const createWorkspaceRequestSchema = z.object({
  cwd: z.string().trim().min(1).max(4_096).startsWith("/"),
  label: z.string().trim().min(1).max(80),
});

export const createWorkspaceResponseSchema = z.object({ workspace: workspaceSchema });

export const createTabRequestSchema = z.object({
  label: z.string().trim().min(1).max(80),
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

export const imageUploadSchema = z.object({
  id: z.string().regex(/^[0-9a-f-]{36}\.(?:png|jpg|gif|webp)$/),
  path: z.string(),
  url: z.string(),
});

export const chatMessageSchema = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant", "tool", "status"]),
  text: z.string(),
  toolName: z.string().optional(),
  isError: z.boolean().optional(),
  timestamp: z.number().optional(),
  attachments: z.array(z.string()).optional(),
});

export const agentTranscriptSchema = z.object({
  messages: z.array(chatMessageSchema),
  status: z.object({
    cwd: z.string(),
    model: z.string().optional(),
    provider: z.string().optional(),
    sessionName: z.string().optional(),
    totalTokens: z.number(),
    cost: z.number(),
    nativeLines: z.array(z.string()).optional(),
    workingSince: z.number().optional(),
  }),
});

export type PiTreeNode = {
  id: string;
  parentId: string | null;
  role: "user" | "assistant";
  text: string;
  timestamp?: string;
  label?: string;
  isActivePath: boolean;
  children: PiTreeNode[];
};

export const piTreeNodeSchema: z.ZodType<PiTreeNode> = z.lazy(() =>
  z.object({
    id: z.string(),
    parentId: z.string().nullable(),
    role: z.enum(["user", "assistant"]),
    text: z.string(),
    timestamp: z.string().optional(),
    label: z.string().optional(),
    isActivePath: z.boolean(),
    children: z.array(piTreeNodeSchema),
  }),
);

export const piTreeResponseSchema = z.object({
  roots: z.array(piTreeNodeSchema),
  leafId: z.string().nullable(),
});

export const navigateTreeRequestSchema = z.object({
  entryId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
});

export const promptRequestSchema = z
  .object({
    text: z.string().trim().max(32_000),
    attachments: z
      .array(z.string().regex(/^[0-9a-f-]{36}\.(?:png|jpg|gif|webp)$/))
      .max(4)
      .default([]),
  })
  .refine((value) => value.text.length > 0 || value.attachments.length > 0, {
    message: "A message or attachment is required",
  });

export const keyNameSchema = z.enum([
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
export type AgentTranscript = z.infer<typeof agentTranscriptSchema>;
export type ChatMessage = z.infer<typeof chatMessageSchema>;
export type AgentStatus = z.infer<typeof agentStatusSchema>;
export type CreateAgentRequest = z.infer<typeof createAgentRequestSchema>;
export type CreateWorkspaceRequest = z.infer<typeof createWorkspaceRequestSchema>;
export type CreateTabRequest = z.infer<typeof createTabRequestSchema>;
export type KeyName = z.infer<typeof keyNameSchema>;
export type TerminalOutput = z.infer<typeof terminalOutputSchema>;
export type PiTreeResponse = z.infer<typeof piTreeResponseSchema>;
export type ShellTab = z.infer<typeof shellTabSchema>;
export type Workspace = z.infer<typeof workspaceSchema>;
