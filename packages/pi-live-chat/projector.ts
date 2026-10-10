import { MAX_IMAGES, MAX_MESSAGES, MAX_SNAPSHOT, MAX_TEXT, type ChatMessage } from "./protocol.js";

type RecordValue = Record<string, unknown>;
function record(value: unknown): RecordValue {
  return value && typeof value === "object" ? (value as RecordValue) : {};
}
function messageKey(value: unknown) {
  const m = record(value);
  return m.role === "toolResult"
    ? `tool:${String(m.toolCallId)}`
    : `${String(m.role)}:${String(m.timestamp)}`;
}
function text(value: unknown) {
  return typeof value === "string"
    ? value.slice(0, MAX_TEXT) + (value.length > MAX_TEXT ? "\n[truncated]" : "")
    : "";
}
// Only small, validated raster ImageContent values reach a browser; never file paths or SVG.
export function imageUrl(value: unknown): string | undefined {
  const b = record(value);
  if (
    b.type !== "image" ||
    typeof b.data !== "string" ||
    b.data.length > 174_764 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(b.data)
  )
    return;
  const bytes = Buffer.from(b.data, "base64");
  const valid =
    b.mimeType === "image/png"
      ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : b.mimeType === "image/jpeg"
        ? bytes[0] === 255 && bytes[1] === 216 && bytes.at(-2) === 255 && bytes.at(-1) === 217
        : b.mimeType === "image/gif"
          ? ["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString())
          : b.mimeType === "image/webp"
            ? bytes.subarray(0, 4).toString() === "RIFF" &&
              bytes.subarray(8, 12).toString() === "WEBP"
            : false;
  if (valid) return `data:${b.mimeType};base64,${b.data}`;
}
export function projectMessage(value: unknown, id: string, resolveImage = imageUrl): ChatMessage[] {
  const m = record(value);
  if (m.role !== "user" && m.role !== "assistant" && m.role !== "toolResult") return [];
  const blocks =
    typeof m.content === "string"
      ? [{ type: "text", text: m.content }]
      : Array.isArray(m.content)
        ? m.content.slice(0, 128).map(record)
        : [];
  const timestamp =
    typeof m.timestamp === "number" && Number.isFinite(m.timestamp) ? m.timestamp : undefined;
  const rows: ChatMessage[] = [];
  const body = text(
    blocks
      .filter((b) => b.type === "text")
      .map((b) => text(b.text))
      .join("\n"),
  );
  const thinking = text(
    blocks
      .filter((b) => b.type === "thinking" && !b.redacted)
      .map((b) => text(b.thinking))
      .join("\n"),
  );
  if (thinking) rows.push({ id: `${id}:thinking`, role: "thinking", text: thinking, timestamp });
  if (m.role === "assistant") {
    for (const b of blocks)
      if (b.type === "toolCall" && typeof b.id === "string") {
        rows.push({
          id: `tool:${b.id}`.slice(0, 256),
          role: "tool",
          toolName: text(b.name).slice(0, 256),
          text: "Tool call",
          timestamp,
        });
      }
  }
  const images = blocks.filter((b) => b.type === "image").map(resolveImage);
  const attachments = images.filter((s): s is string => Boolean(s)).slice(0, MAX_IMAGES);
  const omitted = images.some((url) => !url);
  if (body || attachments.length || omitted || m.role === "toolResult")
    rows.push({
      id: m.role === "toolResult" ? messageKey(m).slice(0, 256) : id,
      role: m.role === "toolResult" ? "tool" : m.role,
      text: text(body + (omitted ? "\n[Image omitted: unsupported or over 128 KiB]" : "")),
      timestamp,
      attachments: attachments.length ? attachments : undefined,
      ...(m.role === "toolResult"
        ? { toolName: text(m.toolName).slice(0, 256), isError: m.isError === true }
        : {}),
    });
  if (m.role === "assistant" && (m.stopReason === "aborted" || m.stopReason === "error"))
    rows.push({
      id: `${id}:status`,
      role: "status",
      text: m.stopReason === "aborted" ? "Agent stopped" : text(m.errorMessage) || "Model error",
      timestamp,
    });
  return rows;
}

export class TranscriptProjector {
  constructor(private readonly resolveImage = imageUrl) {}
  private history: ChatMessage[] = [];
  private live = new Map<string, ChatMessage[]>();
  private persisted = new Set<string>();
  truncated = false;
  totalTokens = 0;
  cost = 0;

  reconcile(branch: readonly unknown[], preserveLive = false) {
    this.history = [];
    this.persisted.clear();
    if (!preserveLive) this.live.clear();
    let historyBytes = 0;
    this.truncated = branch.length > MAX_MESSAGES;
    this.totalTokens = 0;
    this.cost = 0;
    for (const raw of branch.slice(-MAX_MESSAGES)) {
      const entry = record(raw);
      if (entry.type !== "message") continue;
      const m = record(entry.message);
      this.persisted.add(messageKey(m));
      for (const row of projectMessage(m, String(entry.id).slice(0, 200), this.resolveImage)) {
        this.history.push(row);
        historyBytes += Buffer.byteLength(JSON.stringify(row));
        while (historyBytes > MAX_SNAPSHOT || this.history.length > MAX_MESSAGES) {
          historyBytes -= Buffer.byteLength(JSON.stringify(this.history.shift()!));
          this.truncated = true;
        }
      }
      const usage = record(m.usage);
      if (typeof usage.totalTokens === "number" && Number.isFinite(usage.totalTokens))
        this.totalTokens += usage.totalTokens;
      const cost = record(usage.cost).total;
      if (typeof cost === "number" && Number.isFinite(cost)) this.cost += cost;
    }
    for (const key of this.persisted) this.live.delete(key);
  }
  message(value: unknown) {
    const key = messageKey(value);
    if (this.persisted.has(key)) return;
    this.put(key, projectMessage(value, `live:${key}`.slice(0, 200), this.resolveImage));
  }
  tool(event: {
    toolCallId: string;
    toolName: string;
    partialResult?: unknown;
    result?: unknown;
    isError?: boolean;
  }) {
    const key = `tool:${event.toolCallId}`;
    if (this.persisted.has(key)) return;
    const result = record(event.result ?? event.partialResult);
    const rows = projectMessage(
      {
        role: "toolResult",
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        content: result.content ?? "Running…",
        isError: event.isError,
      },
      key,
      this.resolveImage,
    );
    this.put(key, rows);
  }
  private put(key: string, rows: ChatMessage[]) {
    this.live.set(key, this.bound(rows));
    // Bounded independently of how long a tool/turn runs.
    let bytes = [...this.live.values()].reduce(
      (sum, value) => sum + Buffer.byteLength(JSON.stringify(value)),
      0,
    );
    while (this.live.size > 64 || bytes > MAX_SNAPSHOT) {
      const first = this.live.keys().next().value!;
      bytes -= Buffer.byteLength(JSON.stringify(this.live.get(first)));
      this.live.delete(first);
      this.truncated = true;
    }
  }
  private bound(rows: ChatMessage[]) {
    const selected: ChatMessage[] = [];
    let bytes = 0;
    for (let i = rows.length - 1; i >= 0; i--) {
      bytes += Buffer.byteLength(JSON.stringify(rows[i]));
      if (bytes > MAX_SNAPSHOT || selected.length >= MAX_MESSAGES) {
        this.truncated = true;
        break;
      }
      selected.push(rows[i]);
    }
    return selected.reverse();
  }
  messages() {
    const byId = new Map(this.history.map((m) => [m.id, m]));
    for (const rows of this.live.values()) for (const row of rows) byId.set(row.id, row);
    return this.bound([...byId.values()]);
  }
}
