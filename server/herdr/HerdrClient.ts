import { randomUUID } from "node:crypto";
import net from "node:net";
import { z } from "zod";
import type { ZodType } from "zod";

const DEFAULT_TIMEOUT_MS = 5000;

type HerdrParamValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | ReadonlyArray<HerdrParamValue>
  | { readonly [key: string]: HerdrParamValue };
export type HerdrParams = Readonly<Record<string, HerdrParamValue>>;

const errorEnvelopeSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});

export class HerdrRequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "HerdrRequestError";
  }
}

export class HerdrClient {
  constructor(
    private readonly socketPath: string,
    private readonly timeoutMs = DEFAULT_TIMEOUT_MS,
  ) {}

  request<T>(method: string, params: HerdrParams, schema: ZodType<T>) {
    const id = randomUUID();

    return new Promise<T>((resolve, reject) => {
      const socket = net.createConnection({ path: this.socketPath });
      let buffer = "";
      let settled = false;

      const finish = (callback: () => void) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        socket.destroy();
        callback();
      };

      const timeout = setTimeout(() => {
        finish(() => reject(new HerdrRequestError("timeout", "Herdr did not respond in time")));
      }, this.timeoutMs);

      socket.setEncoding("utf8");

      socket.on("connect", () => {
        socket.write(`${JSON.stringify({ id, method, params })}\n`);
      });

      socket.on("data", (chunk) => {
        buffer += chunk;
        const lineEnd = buffer.indexOf("\n");
        if (lineEnd === -1) {
          return;
        }

        const line = buffer.slice(0, lineEnd);

        try {
          const envelope: unknown = JSON.parse(line);
          if (envelope === null || typeof envelope !== "object") {
            throw new Error("Invalid Herdr response envelope");
          }
          if (!("id" in envelope) || envelope.id !== id) {
            return;
          }

          if ("error" in envelope) {
            const { error } = errorEnvelopeSchema.parse(envelope);
            finish(() => reject(new HerdrRequestError(error.code, error.message)));
            return;
          }

          const parsed = schema.safeParse("result" in envelope ? envelope.result : undefined);
          if (!parsed.success) {
            finish(() =>
              reject(
                new HerdrRequestError("invalid_response", "Herdr returned an unexpected response"),
              ),
            );
            return;
          }

          finish(() => resolve(parsed.data));
        } catch {
          finish(() =>
            reject(new HerdrRequestError("invalid_json", "Herdr returned invalid JSON")),
          );
        }
      });

      socket.on("error", (error) => {
        finish(() => reject(new HerdrRequestError("unavailable", error.message)));
      });

      socket.on("end", () => {
        finish(() => reject(new HerdrRequestError("disconnected", "Herdr closed the connection")));
      });
    });
  }
}
