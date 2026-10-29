export const READ_RECEIPT_REQUEST_ID_HEADER = "X-Fernblick-Read-Request-Id";

export function safeReadReceiptRequestId(value: unknown): string | undefined {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)
    ? value
    : undefined;
}

type Category =
  | "success"
  | "stale"
  | "network"
  | "timeout"
  | "aborted"
  | "http"
  | "request_validation"
  | "response_validation"
  | "storage"
  | "dependency"
  | "unexpected";

interface Diagnostic {
  boundary: "client" | "request" | "persistence";
  operation: "save" | "load" | "cleanup";
  requestId: string;
  category: Category;
  status?: number;
  durationMs: number;
}

/** Fixed-size, process/page-local rate limit. Never accept payloads or error objects. */
export function createReadReceiptDiagnostics() {
  let windowStart = 0;
  let emitted = 0;
  let suppressed = 0;
  return (event: Diagnostic) => {
    // Diagnostics must never change the result of saving a receipt.
    try {
      const now = Date.now();
      if (now - windowStart >= 60_000) {
        windowStart = now;
        emitted = 0;
      }
      if (emitted >= 30) {
        suppressed = Math.min(suppressed + 1, Number.MAX_SAFE_INTEGER);
        return;
      }
      emitted++;
      // Explicitly select fields: no spreading caller objects into logs.
      const record = {
        event: "read_receipt",
        timestamp: new Date(now).toISOString(),
        boundary: event.boundary,
        operation: event.operation,
        requestId: safeReadReceiptRequestId(event.requestId),
        category: event.category,
        status: event.status,
        durationMs: Math.max(0, Math.round(event.durationMs)),
        suppressed,
      };
      suppressed = 0;
      const level = event.category === "success" || event.category === "stale" ? "info" : "warn";
      console[level](JSON.stringify(record));
    } catch {
      // Logging is best effort, including when a console sink is unavailable.
    }
  };
}
