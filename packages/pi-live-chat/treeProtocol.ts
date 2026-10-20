import { z } from "zod";

export const TREE_PAGE_SIZE = 50;
export const TREE_PREVIEW_LENGTH = 240;
export const MAX_TREE_PAGE_BYTES = 128 * 1024;
const id = z.string().min(1).max(256);
export const treePageRequestSchema = z
  .object({
    query: z.string().trim().max(256).default(""),
    filter: z.enum(["all", "user", "labels"]).default("all"),
    focusId: id.optional(),
    branchesOf: id.nullable().optional(),
    offset: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
    revision: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
  })
  .refine(
    (value) => value.offset === undefined || value.revision !== undefined,
    "Paging requires a tree revision",
  );
export type TreePageRequest = z.input<typeof treePageRequestSchema>;
const treePageRowSchema = z.object({
  id,
  parentId: id.nullable(),
  role: z.enum(["user", "assistant"]),
  text: z.string().max(TREE_PREVIEW_LENGTH),
  textTruncated: z.boolean(),
  timestamp: z.string().max(64).optional(),
  label: z.string().max(128).optional(),
  isActivePath: z.boolean(),
  childCount: z.number().int().nonnegative(),
});
export type TreePageRow = z.infer<typeof treePageRowSchema>;
export const treePageSchema = z
  .object({
    rows: z.array(treePageRowSchema).max(TREE_PAGE_SIZE),
    leafId: id.nullable(),
    focusId: id.nullable(),
    mode: z.enum(["path", "branches", "search"]),
    total: z.number().int().nonnegative(),
    rootCount: z.number().int().nonnegative(),
    offset: z.number().int().nonnegative(),
    previousOffset: z.number().int().nonnegative().nullable(),
    nextOffset: z.number().int().nonnegative().nullable(),
    revision: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .refine(
    (page) =>
      page.offset + page.rows.length <= page.total &&
      (page.total === 0 ? page.rows.length === 0 && page.offset === 0 : page.rows.length > 0) &&
      (page.previousOffset === null || page.previousOffset < page.offset) &&
      (page.nextOffset === null ||
        (page.nextOffset === page.offset + page.rows.length && page.nextOffset < page.total)) &&
      new Set(page.rows.map((row) => row.id)).size === page.rows.length,
    "Invalid conversation page boundaries",
  )
  .refine(
    (page) => new TextEncoder().encode(JSON.stringify(page)).byteLength <= MAX_TREE_PAGE_BYTES,
    "Conversation page exceeds the byte budget",
  );
export type TreePage = z.infer<typeof treePageSchema>;
