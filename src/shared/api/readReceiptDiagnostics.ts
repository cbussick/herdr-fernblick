import { z } from "zod";

export const READ_RECEIPT_REQUEST_ID_HEADER = "X-Fernblick-Read-Request-Id";
const requestIdSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const buildSchema = z.string().regex(/^(?:development|unknown|[a-f0-9]{40}(?:-dirty)?)$/);
const categorySchema = z.enum([
  "success",
  "stale",
  "network",
  "timeout",
  "aborted",
  "http",
  "request_validation",
  "response_validation",
  "storage",
  "dependency",
  "unexpected",
]);
const errorCodeSchema = z.enum([
  "ENOSPC",
  "EACCES",
  "EPERM",
  "EIO",
  "EROFS",
  "EMFILE",
  "ENFILE",
  "ENOENT",
  "ELOOP",
]);

export function safeReadReceiptRequestId(value: unknown): string | undefined {
  return requestIdSchema.safeParse(value).data;
}

export function safeReadReceiptErrorCode(error: unknown) {
  try {
    return errorCodeSchema.safeParse(
      error && typeof error === "object" && "code" in error ? error.code : undefined,
    ).data;
  } catch {
    return undefined;
  }
}

const diagnosticSchema = z.object({
  boundary: z.enum(["client", "request", "persistence"]),
  operation: z.enum(["save", "load", "cleanup"]),
  requestId: requestIdSchema.optional(),
  category: categorySchema,
  status: z.number().int().min(100).max(599).optional(),
  durationMs: z.number().int().min(0).max(86_400_000),
  errorCode: errorCodeSchema.optional(),
});

/** Parse/strip again at storage and export boundaries; persisted data is untrusted. */
export const readReceiptRecordSchema = diagnosticSchema.extend({
  event: z.literal("read_receipt"),
  schemaVersion: z.literal(1),
  timestamp: z.iso.datetime(),
  build: buildSchema,
  severity: z.enum(["info", "warn"]),
  suppressed: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  dropped: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
});
export type ReadReceiptRecord = z.infer<typeof readReceiptRecordSchema>;
type Diagnostic = Omit<z.infer<typeof diagnosticSchema>, "requestId"> & { requestId: string };
export type ReadReceiptDiagnosticOptions = {
  build?: string;
  sink?: (record: ReadReceiptRecord) => void;
  console?: boolean;
};

export function createReadReceiptDiagnostics(options: ReadReceiptDiagnosticOptions = {}) {
  let windowStart = 0;
  const emitted = { routine: 0, failure: 0 };
  let suppressed = 0;
  let dropped = 0;
  return (event: Diagnostic) => {
    // Best effort: logging must never change a receipt's outcome.
    try {
      const now = Date.now();
      if (now - windowStart >= 60_000 || now < windowStart) {
        windowStart = now;
        emitted.routine = emitted.failure = 0;
      }
      const severity = event.category === "success" || event.category === "stale" ? "info" : "warn";
      const bucket = severity === "info" ? "routine" : "failure";
      if (emitted[bucket] >= 30) {
        suppressed = Math.min(suppressed + 1, Number.MAX_SAFE_INTEGER);
        return;
      }
      const record = readReceiptRecordSchema.parse({
        // Explicit selection, not caller spreading (even after TypeScript checks).
        event: "read_receipt",
        schemaVersion: 1,
        timestamp: new Date(now).toISOString(),
        build: buildSchema.safeParse(options.build).data ?? "unknown",
        boundary: event.boundary,
        operation: event.operation,
        requestId: safeReadReceiptRequestId(event.requestId),
        category: event.category,
        severity,
        status: event.status,
        errorCode: errorCodeSchema.safeParse(event.errorCode).data,
        durationMs: Math.max(0, Math.round(event.durationMs)),
        suppressed,
        dropped,
      });
      emitted[bucket]++;
      suppressed = dropped = 0;
      try {
        options.sink?.(record);
      } catch {
        dropped++;
      }
      if (options.console ?? !options.sink) console[severity](JSON.stringify(record));
    } catch {
      dropped = Math.min(dropped + 1, Number.MAX_SAFE_INTEGER);
    }
  };
}
