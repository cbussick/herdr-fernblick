import { z } from "zod";
import { messageSchema, snapshotSchema, MAX_MESSAGES, type Snapshot } from "./protocol.js";

const patchSchema = snapshotSchema.omit({ type: true, messages: true }).extend({
  type: z.literal("patch"),
  baseSeq: z.number().int().nonnegative(),
  upsert: z.array(messageSchema).max(MAX_MESSAGES),
  order: z.array(z.string().min(1).max(256)).max(MAX_MESSAGES).optional(),
});
// Each browser starts with a full snapshot. Only changed rows travel afterwards.
export function browserFrame(previous: Snapshot | undefined, next: Snapshot) {
  if (
    !previous ||
    previous.epoch !== next.epoch ||
    previous.identity.runtime !== next.identity.runtime ||
    previous.identity.sessionId !== next.identity.sessionId
  )
    return next;
  const old = new Map(previous.messages.map((message) => [message.id, message]));
  const upsert = next.messages.filter(
    (message) => JSON.stringify(old.get(message.id)) !== JSON.stringify(message),
  );
  const order = next.messages.map((message) => message.id);
  const sameOrder =
    order.length === previous.messages.length &&
    order.every((id, index) => previous.messages[index].id === id);
  const { messages: _messages, type: _type, ...metadata } = next;
  return {
    ...metadata,
    type: "patch" as const,
    baseSeq: previous.seq,
    upsert,
    ...(sameOrder ? {} : { order }),
  };
}
export function readBrowserFrame(previous: Snapshot | undefined, value: unknown): Snapshot {
  if (typeof value === "object" && value && "type" in value && value.type === "snapshot")
    return snapshotSchema.parse(value);
  const patch = patchSchema.parse(value);
  if (
    !previous ||
    previous.seq !== patch.baseSeq ||
    previous.epoch !== patch.epoch ||
    previous.identity.runtime !== patch.identity.runtime ||
    previous.identity.sessionId !== patch.identity.sessionId
  )
    throw new Error("Live chat snapshot required");
  const rows = new Map(previous.messages.map((message) => [message.id, message]));
  for (const message of patch.upsert) rows.set(message.id, message);
  const order = patch.order ?? previous.messages.map((message) => message.id);
  if (new Set(order).size !== order.length) throw new Error("Duplicate live chat rows");
  const messages = order.map((id) => {
    const message = rows.get(id);
    if (!message) throw new Error("Missing live chat row");
    return message;
  });
  const { baseSeq: _baseSeq, upsert: _upsert, order: _order, ...metadata } = patch;
  // Metadata and changed rows are validated above; untouched rows were validated
  // with the baseline. Keep their identities and avoid reparsing the entire history.
  return { ...metadata, type: "snapshot", messages };
}
