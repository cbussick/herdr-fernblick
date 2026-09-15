import { randomUUID } from "node:crypto";
import net from "node:net";
import type { ZodType } from "zod";

const DEFAULT_TIMEOUT_MS = 5_000;

type HerdrResult = Record<string, unknown>;

interface HerdrSuccessEnvelope {
  id: string;
  result: HerdrResult;
}

interface HerdrErrorEnvelope {
  error: {
    code: string;
    message: string;
  };
  id: string;
}

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

  request<T>(method: string, params: Record<string, unknown>, schema: ZodType<T>) {
    const id = randomUUID();

    return new Promise<T>((resolve, reject) => {
      const socket = net.createConnection({ path: this.socketPath });
      let buffer = "";
      let settled = false;

      const finish = (callback: () => void) => {
        if (settled) return;
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
        if (lineEnd === -1) return;

        const line = buffer.slice(0, lineEnd);

        try {
          const envelope = JSON.parse(line) as HerdrSuccessEnvelope | HerdrErrorEnvelope;
          if (envelope.id !== id) return;

          if ("error" in envelope) {
            finish(() =>
              reject(new HerdrRequestError(envelope.error.code, envelope.error.message)),
            );
            return;
          }

          const parsed = schema.safeParse(envelope.result);
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
