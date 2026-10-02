import { z } from "zod";

// Browser documents use the native Excalidraw format; the agent gets only a
// bounded summary and a deliberately small operation vocabulary, never JS.
export const MAX_BOARD_BYTES = 12 * 1024 * 1024;
export const boardIdSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const elementIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);
const coordinate = z.number().finite().min(-1_000_000).max(1_000_000);
const dimension = z.number().finite().min(0).max(100_000);
export const boardElementSchema = z
  .object({
    id: elementIdSchema,
    type: z.enum([
      "rectangle",
      "ellipse",
      "diamond",
      "text",
      "arrow",
      "line",
      "freedraw",
      "image",
      "frame",
    ]),
    x: coordinate,
    y: coordinate,
    width: dimension,
    height: dimension,
    isDeleted: z.boolean().optional(),
  })
  .catchall(z.json());
export const boardFileSchema = z.object({
  id: z.string().min(1).max(128),
  mimeType: z.enum(["image/png", "image/jpeg", "image/gif", "image/webp"]),
  dataURL: z
    .string()
    .max(10 * 1024 * 1024)
    .regex(/^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/]*={0,2}$/),
  created: z.number().finite(),
  lastRetrieved: z.number().finite().optional(),
});
export const boardSceneSchema = z.object({
  elements: z.array(boardElementSchema).max(2000),
  files: z
    .record(z.string().max(128), boardFileSchema)
    .refine((v) => Object.keys(v).length <= 32, "Too many board images"),
  background: z.string().regex(/^#[a-fA-F0-9]{6}$/),
});
export type BoardScene = z.infer<typeof boardSceneSchema>;
export type BoardElement = z.infer<typeof boardElementSchema>;
export const boardModeSchema = z.enum(["image", "read", "edit"]);
export type BoardMode = z.infer<typeof boardModeSchema>;
export const boardGrantSchema = z.object({
  boardId: boardIdSchema,
  grantId: z.string().uuid(),
  mode: z.enum(["read", "edit"]),
  revision: z.number().int().nonnegative(),
});
export type BoardGrant = z.infer<typeof boardGrantSchema>;
export const boardTargetSchema = z.object({
  runtime: z.string().uuid(),
  epoch: z.string().uuid(),
  sessionId: z.string().min(1).max(256),
});
export type BoardTarget = z.infer<typeof boardTargetSchema>;
const color = z.string().regex(/^#[a-fA-F0-9]{6}$/);
const operationContext = {
  dependsOn: z.array(elementIdSchema).max(50).optional(),
  groupId: elementIdSchema.optional(),
};
export const boardOperationSchema = z.discriminatedUnion("op", [
  z
    .object({
      ...operationContext,
      op: z.literal("create"),
      id: elementIdSchema,
      kind: z.enum(["rectangle", "text", "arrow"]),
      x: coordinate,
      y: coordinate,
      width: dimension.optional(),
      height: dimension.optional(),
      text: z.string().max(4000).optional(),
      endX: coordinate.optional(),
      endY: coordinate.optional(),
      color: color.optional(),
      background: color.optional(),
      fontSize: z.number().int().min(12).max(96).optional(),
    })
    .strict(),
  z
    .object({
      ...operationContext,
      op: z.literal("update"),
      id: elementIdSchema,
      x: coordinate.optional(),
      y: coordinate.optional(),
      width: dimension.optional(),
      height: dimension.optional(),
      text: z.string().max(4000).optional(),
      endX: coordinate.optional(),
      endY: coordinate.optional(),
      color: color.optional(),
      background: color.optional(),
      fontSize: z.number().int().min(12).max(96).optional(),
    })
    .strict(),
  z.object({ ...operationContext, op: z.literal("delete"), id: elementIdSchema }).strict(),
]);
export type BoardOperation = z.infer<typeof boardOperationSchema>;
export const boardRequestSchema = z.object({
  type: z.literal("board-request"),
  id: z.string().uuid(),
  target: boardTargetSchema,
  grantId: z.string().uuid(),
  boardId: boardIdSchema,
  action: z.enum(["activate", "read", "apply", "revoke"]),
  offset: z.number().int().min(0).max(2000).optional(),
  limit: z.number().int().min(1).max(100).optional(),
  baseRevision: z.number().int().nonnegative().optional(),
  operationId: z.string().uuid().optional(),
  operations: z.array(boardOperationSchema).min(1).max(50).optional(),
});
export type BoardRequest = z.infer<typeof boardRequestSchema>;
export const boardReplySchema = z.object({
  type: z.literal("board-reply"),
  id: z.string().uuid(),
  ok: z.boolean(),
  error: z.string().max(1024).optional(),
  data: z.json().optional(),
});
export type BoardReply = z.infer<typeof boardReplySchema>;
export const boardRevokeSchema = z.object({
  type: z.literal("board-revoke"),
  grantId: z.string().uuid(),
});
export const boardSnapshotRefSchema = z.object({
  id: z.string().uuid(),
  revision: z.number().int().nonnegative(),
  createdAt: z.number(),
});
export const boardStateSchema = z.object({
  id: boardIdSchema,
  revision: z.number().int().nonnegative(),
  scene: boardSceneSchema,
  updatedAt: z.number(),
  lastAuthor: z.enum(["human", "agent"]),
  snapshots: z.array(boardSnapshotRefSchema),
  access: z
    .object({
      mode: z.enum(["read", "edit"]),
      state: z.enum(["pending", "active"]),
      expiresAt: z.number(),
    })
    .nullable(),
});
export type BoardState = z.infer<typeof boardStateSchema>;
