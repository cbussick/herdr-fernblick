import { z } from "zod";
import {
  boardIdSchema,
  boardSceneSchema,
  boardStateSchema,
  boardTargetSchema,
  type BoardTarget,
} from "../../../packages/pi-live-chat/boardProtocol";
import { ackSchema, uploadIdSchema } from "../../../packages/pi-live-chat/protocol";
import { ApiError } from "../../shared/api/apiClient";

const saveSchema = z.object({
  target: boardTargetSchema,
  boardId: boardIdSchema,
  baseRevision: z.number().int().nonnegative(),
  scene: boardSceneSchema,
});
const sendSchema = z.object({
  target: boardTargetSchema,
  boardId: boardIdSchema,
  revision: z.number().int().nonnegative(),
  uploadId: uploadIdSchema,
  mode: z.literal("image"),
  text: z.string().max(29000),
  requestId: z.string().uuid(),
});
const promptSchema = sendSchema
  .omit({ uploadId: true, mode: true })
  .extend({
    text: z.string().trim().min(1).max(29000),
    uploadId: uploadIdSchema.optional(),
  })
  .strict();
export const boardEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("changed"),
    revision: z.number().int().nonnegative(),
    access: boardStateSchema.shape.access,
    lastAuthor: z.string(),
    snapshots: z.number().int().min(0).max(128).optional(),
  }),
  z.object({ type: z.literal("unavailable"), reason: z.string() }),
]);
export type BoardEvent = z.infer<typeof boardEventSchema>;

function endpoint(pane: string) {
  return `/api/agents/${encodeURIComponent(pane)}/board`;
}
async function post(pane: string, suffix: string, input: unknown, signal?: AbortSignal) {
  const response = await fetch(endpoint(pane) + suffix, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(15000)])
      : AbortSignal.timeout(15000),
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = z.object({ error: z.string(), code: z.string().optional() }).safeParse(body);
    throw new ApiError(
      response.status,
      response.status === 404
        ? "Whiteboard endpoint unavailable. Run /reload in Pi, then reopen the whiteboard."
        : error.success
          ? error.data.error
          : "Whiteboard request failed",
      error.success ? error.data.code : undefined,
    );
  }
  return body;
}
async function forward(
  pane: string,
  suffix: string,
  parsed: { requestId: string },
  signal?: AbortSignal,
) {
  let body: unknown;
  try {
    body = await post(pane, suffix, parsed, signal);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new Error(
      "Delivery uncertain. Check the conversation before sending again; your draft is retained.",
      { cause: error },
    );
  }
  const ack = ackSchema.safeParse(body);
  if (!ack.success || ack.data.id !== parsed.requestId)
    throw new Error(
      "Invalid acknowledgement; delivery uncertain. Check the conversation before sending again.",
    );
  if (ack.data.outcome !== "invoked") throw new Error(ack.data.reason ?? "Pi rejected the request");
  return ack.data;
}
export const boardApi = {
  async open(pane: string, target: BoardTarget, signal?: AbortSignal) {
    return boardStateSchema.parse(
      await post(pane, "", { target: boardTargetSchema.parse(target) }, signal),
    );
  },
  async save(pane: string, input: z.infer<typeof saveSchema>, signal?: AbortSignal) {
    return boardStateSchema.parse(await post(pane, "/save", saveSchema.parse(input), signal));
  },
  async send(pane: string, input: z.infer<typeof sendSchema>, signal?: AbortSignal) {
    return forward(pane, "/send", sendSchema.parse(input), signal);
  },
  async prompt(pane: string, input: z.infer<typeof promptSchema>, signal?: AbortSignal) {
    return forward(pane, "/prompt", promptSchema.parse(input), signal);
  },
  async revoke(pane: string, target: BoardTarget, boardId: string, signal?: AbortSignal) {
    const input = z
      .object({ target: boardTargetSchema, boardId: boardIdSchema })
      .parse({ target, boardId });
    return z.object({ ok: z.literal(true) }).parse(await post(pane, "/revoke", input, signal));
  },
  events(
    pane: string,
    target: BoardTarget,
    onEvent: (event: BoardEvent) => void,
    onDisconnect: () => void,
  ) {
    const source = new EventSource(`${endpoint(pane)}/events?${new URLSearchParams(target)}`);
    source.onmessage = (event) => {
      try {
        onEvent(boardEventSchema.parse(JSON.parse(event.data)));
      } catch {
        onDisconnect();
      }
    };
    source.onerror = onDisconnect;
    return () => source.close();
  },
};

export function requestId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
