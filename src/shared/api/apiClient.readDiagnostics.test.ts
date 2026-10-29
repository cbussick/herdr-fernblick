import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { READ_RECEIPT_REQUEST_ID_HEADER } from "./readReceiptDiagnostics";

const input = { paneId: "private-pane", completionId: "a".repeat(64) };
const fetchMock = vi.fn();
let markAgentRead: typeof import("./apiClient").markAgentRead;
let warn: ReturnType<typeof vi.spyOn>;
let info: ReturnType<typeof vi.spyOn>;
beforeEach(async () => {
  vi.resetModules();
  ({ markAgentRead } = await import("./apiClient"));
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  info = vi.spyOn(console, "info").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it.each([
  [500, { error: "credential /sessions/secret.jsonl chat content" }, "http"],
  [200, { ok: false, content: "chat content" }, "response_validation"],
  [200, "not-json", "response_validation"],
  [503, "not-json", "http"],
] as const)("classifies status %s and redacts response content", async (status, body, category) => {
  fetchMock.mockResolvedValueOnce(
    typeof body === "string" ? new Response(body, { status }) : Response.json(body, { status }),
  );
  await expect(markAgentRead(input)).rejects.toThrow();
  const record = JSON.parse(warn.mock.calls[0][0]);
  expect(record).toMatchObject({
    boundary: "client",
    operation: "save",
    category,
    status,
    timestamp: expect.any(String),
    durationMs: expect.any(Number),
    requestId: fetchMock.mock.calls[0][1].headers[READ_RECEIPT_REQUEST_ID_HEADER],
  });
  expect(JSON.stringify(record)).not.toMatch(
    /credential|sessions|chat content|private-pane|aaaaaaaa/,
  );
  expect(fetchMock).toHaveBeenCalledOnce();
});

it.each([404, 409])("logs stale %s at info and preserves the rejection", async (status) => {
  fetchMock.mockResolvedValueOnce(Response.json({ error: "changed" }, { status }));
  await expect(markAgentRead(input)).rejects.toMatchObject({ status });
  expect(JSON.parse(info.mock.calls[0][0])).toMatchObject({ category: "stale", status });
  expect(warn).not.toHaveBeenCalled();
});

it("distinguishes network loss from the ten-second timeout without retries", async () => {
  fetchMock.mockRejectedValueOnce(new TypeError("secret payload"));
  await expect(markAgentRead(input)).rejects.toThrow();
  expect(JSON.parse(warn.mock.calls[0][0]).category).toBe("network");
  const controller = new AbortController();
  vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
  fetchMock.mockImplementationOnce(
    (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(init.signal.reason));
      }),
  );
  const pending = markAgentRead(input);
  const assertion = expect(pending).rejects.toThrow();
  controller.abort(new DOMException("secret", "TimeoutError"));
  await assertion;
  expect(AbortSignal.timeout).toHaveBeenCalledWith(10_000);
  expect(JSON.parse(warn.mock.calls[1][0]).category).toBe("timeout");
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it("logs success with a fresh random ID per attempt and retains request validation", async () => {
  fetchMock.mockImplementation(() => Response.json({ ok: true }));
  await markAgentRead(input);
  await markAgentRead(input);
  const records = info.mock.calls.map(([value]: [string]) => JSON.parse(value));
  expect(records[0]).toMatchObject({ category: "success", status: 200 });
  expect(records[0].requestId).not.toBe(records[1].requestId);
  await expect(markAgentRead({ ...input, completionId: "invalid" })).rejects.toThrow();
  expect(JSON.parse(warn.mock.calls[0][0]).category).toBe("request_validation");
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
