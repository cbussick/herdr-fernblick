import { z } from "zod";

export const MAX_FRAME = 4 * 1024 * 1024;
export const MAX_TEXT = 32_000;
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
        .regex(/^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/]*={0,2}$/),
    )
    .max(4)
    .optional(),
});
export const snapshotSchema = z.object({
  type: z.literal("snapshot"),
  version: z.literal(1),
  identity: identitySchema,
  epoch: z.string().uuid(),
  seq: z.number().int().nonnegative(),
  busy: z.boolean(),
  sendPending: z.boolean(),
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
export const commandSchema = z.discriminatedUnion("action", [
  z.object({
    type: z.literal("command"),
    id: z.string().uuid(),
    target: targetSchema,
    action: z.literal("send"),
    text: z.string().trim().min(1).max(MAX_TEXT),
  }),
  z.object({
    type: z.literal("command"),
    id: z.string().uuid(),
    target: targetSchema,
    action: z.literal("stop"),
  }),
]);
export const ackSchema = z.object({
  type: z.literal("ack"),
  id: z.string().uuid(),
  outcome: z.enum(["invoked", "rejected"]),
  reason: z.string().max(512).optional(),
});
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
