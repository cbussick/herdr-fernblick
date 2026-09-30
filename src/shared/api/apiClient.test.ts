import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { chatCommand, ApiError } from "./apiClient";
const target = { runtime: randomUUID(), epoch: randomUUID(), sessionId: "s" };
const fetchMock = vi.fn();
let controller: AbortController;
beforeEach(() => {
  controller = new AbortController();
  vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it("validates a correlated forwarding ACK and uses a bounded HTTP deadline", async () => {
  const id = randomUUID();
  fetchMock.mockResolvedValue(Response.json({ type: "ack", id, outcome: "invoked" }));
  expect(await chatCommand("w1:p1", target, "prompt", "hello", [], id)).toMatchObject({
    id,
    outcome: "invoked",
  });
  expect(AbortSignal.timeout).toHaveBeenCalledWith(15_000);
  expect(fetchMock.mock.calls[0][1].signal).toBe(controller.signal);
});
it("rejects a wrong or malformed ACK rather than clearing a draft", async () => {
  fetchMock.mockResolvedValueOnce(
    Response.json({ type: "ack", id: randomUUID(), outcome: "invoked" }),
  );
  await expect(chatCommand("w1:p1", target, "prompt", "hello", [], randomUUID())).rejects.toThrow(
    "Invalid forwarding acknowledgement",
  );
  fetchMock.mockResolvedValueOnce(Response.json({ ok: true }));
  await expect(chatCommand("w1:p1", target, "prompt", "hello")).rejects.toThrow(
    "Invalid forwarding acknowledgement",
  );
});
it("preserves explicit backend rejection errors", async () => {
  fetchMock.mockResolvedValue(Response.json({ error: "Pi is busy" }, { status: 409 }));
  await expect(chatCommand("w1:p1", target, "prompt", "hello")).rejects.toBeInstanceOf(ApiError);
  fetchMock.mockResolvedValue(
    Response.json({ type: "ack", id: randomUUID(), outcome: "rejected", reason: "Pi is busy" }),
  );
  await expect(chatCommand("w1:p1", target, "prompt", "hello")).rejects.toThrow("Pi is busy");
});
it("reports timeout and network loss as uncertain and never retries", async () => {
  fetchMock.mockImplementationOnce(
    (_url, init) =>
      new Promise((_done, reject) =>
        init.signal.addEventListener("abort", () => reject(init.signal.reason)),
      ),
  );
  const result = chatCommand("w1:p1", target, "prompt", "hello");
  const assertion = expect(result).rejects.toThrow("delivery uncertain");
  controller.abort(new DOMException("Timed out", "TimeoutError"));
  await assertion;
  expect(fetchMock).toHaveBeenCalledOnce();
  fetchMock.mockRejectedValueOnce(new TypeError("Network lost"));
  await expect(chatCommand("w1:p1", target, "prompt", "hello")).rejects.toThrow(
    "delivery uncertain",
  );
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
