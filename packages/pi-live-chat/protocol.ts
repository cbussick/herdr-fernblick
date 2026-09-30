import { z } from "zod";

export const MAX_FRAME = 4 * 1024 * 1024;
export const MAX_TEXT = 32_000;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const uploadIdPattern =
  /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\.(?:png|jpg|gif|webp)$/;
export const uploadIdSchema = z.string().regex(uploadIdPattern);
export const sendInputSchema = z
  .object({
    text: z.string().trim().max(MAX_TEXT),
    attachments: z.array(uploadIdSchema).max(4).default([]),
  })
  .refine(
    (value) => value.text.length > 0 || value.attachments.length > 0,
    "Message or image required",
  );
export const MAX_MESSAGES = 512;
export const MAX_SNAPSHOT = 2 * 1024 * 1024;
const id = z.string().min(1).max(256);
export const identitySchema = z.object({
  runtime: z.string().uuid(),
  pid: z.number().int().positive(),
  processStart: id,
  pane: id,
  herdrSocket: z.string().startsWith("/").max(4096),
  sessionId: id,
  sessionFile: z.string().startsWith("/").max(4096),
});
export const messageSchema = z.object({
  id,
  role: z.enum(["user", "assistant", "thinking", "tool", "status"]),
  text: z.string().max(MAX_TEXT + 32),
  toolName: z.string().max(256).optional(),
  isError: z.boolean().optional(),
  timestamp: z.number().finite().optional(),
  attachments: z
    .array(
      z
        .string()
        .max(180_000)
        .regex(
          /^(?:data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/]*={0,2}|\/api\/uploads\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\.(?:png|jpg|gif|webp))$/,
        ),
    )
    .max(4)
    .optional(),
});
export const snapshotSchema = z.object({
  type: z.literal("snapshot"),
  version: z.union([z.literal(1), z.literal(2)]),
  identity: identitySchema,
  epoch: z.string().uuid(),
  seq: z.number().int().nonnegative(),
  busy: z.boolean(),
  sendPending: z.boolean(),
  receivedSendIds: z.array(z.string().uuid()).max(128).optional(),
  truncated: z.boolean(),
  messages: z.array(messageSchema).max(MAX_MESSAGES),
  status: z.object({
    cwd: z.string().max(4096),
    model: z.string().max(256).optional(),
    provider: z.string().max(256).optional(),
    totalTokens: z.number().finite(),
    cost: z.number().finite(),
  }),
});
export const targetSchema = z.object({
  runtime: z.string().uuid(),
  epoch: z.string().uuid(),
  sessionId: id,
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
    id,
    parentId: id.nullable(),
    role: z.enum(["user", "assistant"]),
    text: z.string().max(MAX_TEXT),
    timestamp: z.string().max(64).optional(),
    label: z.string().max(256).optional(),
    isActivePath: z.boolean(),
    children: z.array(piTreeNodeSchema).max(2000),
  }),
);
export const piTreeSchema = z.object({
  roots: z.array(piTreeNodeSchema).max(2000),
  leafId: id.nullable(),
});
export type PiTree = z.infer<typeof piTreeSchema>;
export const commandSchema = z
  .discriminatedUnion("action", [
    z.object({
      type: z.literal("command"),
      id: z.string().uuid(),
      target: targetSchema,
      action: z.literal("tree"),
    }),
    z.object({
      type: z.literal("command"),
      id: z.string().uuid(),
      target: targetSchema,
      action: z.literal("navigate"),
      entryId: id,
    }),
    z.object({
      type: z.literal("command"),
      id: z.string().uuid(),
      target: targetSchema,
      action: z.literal("send"),
      text: z.string().trim().max(MAX_TEXT),
      attachments: z.array(uploadIdSchema).max(4).default([]),
    }),
    z.object({
      type: z.literal("command"),
      id: z.string().uuid(),
      target: targetSchema,
      action: z.literal("stop"),
    }),
  ])
  .refine(
    (command) =>
      command.action !== "send" || command.text.length > 0 || command.attachments.length > 0,
    "Message or image required",
  );
export const ackSchema = z.object({
  type: z.literal("ack"),
  id: z.string().uuid(),
  outcome: z.enum(["invoked", "rejected"]),
  reason: z.string().max(512).optional(),
});
export const treeResponseSchema = z.object({
  type: z.literal("tree"),
  id: z.string().uuid(),
  target: targetSchema,
  tree: piTreeSchema,
});
export const navigationResponseSchema = z.object({
  type: z.literal("navigated"),
  id: z.string().uuid(),
  target: targetSchema,
  prompt: z
    .object({ text: z.string().max(MAX_TEXT), attachments: z.array(uploadIdSchema).max(4) })
    .optional(),
});
export const responseSchema = z.union([ackSchema, treeResponseSchema, navigationResponseSchema]);
export type BridgeResponse = z.infer<typeof responseSchema>;
export type Identity = z.infer<typeof identitySchema>;
export type Snapshot = z.infer<typeof snapshotSchema>;
export type ChatMessage = z.infer<typeof messageSchema>;
export type Command = z.infer<typeof commandSchema>;
export type Ack = z.infer<typeof ackSchema>;
export type Target = z.infer<typeof targetSchema>;
export function targetOf(s: Snapshot): Target {
  return { runtime: s.identity.runtime, epoch: s.epoch, sessionId: s.identity.sessionId };
}
export function matchesTarget(s: Snapshot, t: Target) {
  return (
    s.identity.runtime === t.runtime && s.epoch === t.epoch && s.identity.sessionId === t.sessionId
  );
}
