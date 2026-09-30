import { describe, expect, it } from "vitest";
import { TranscriptProjector, imageUrl, projectMessage } from "./projector.js";
import { MAX_MESSAGES, MAX_SNAPSHOT } from "./protocol.js";

const assistant = (text: string, timestamp = 2) => ({
  role: "assistant",
  timestamp,
  content: [
    { type: "thinking", thinking: "reason" },
    { type: "text", text },
  ],
});
const entry = (id: string, message: unknown) => ({ id, type: "message", message });

describe("shared history/live projector", () => {
  it("keeps provisional message_end until authoritative reconciliation, including transformations", () => {
    const p = new TranscriptProjector();
    p.reconcile([entry("u", { role: "user", timestamp: 1, content: "hi" })]);
    p.message(assistant("par"));
    p.message(assistant("partial"));
    expect(p.messages().map((m) => m.text)).toEqual(["hi", "reason", "partial"]);
    // Reconnect while streaming: refresh history without discarding the overlay.
    p.reconcile([entry("u", { role: "user", timestamp: 1, content: "hi" })], true);
    expect(p.messages().at(-1)?.text).toBe("partial");
    p.reconcile([
      entry("u", { role: "user", timestamp: 1, content: "hi" }),
      entry("a", assistant("transformed by a later handler")),
    ]);
    expect(p.messages().map((m) => m.text)).toEqual([
      "hi",
      "reason",
      "transformed by a later handler",
    ]);
    expect(p.messages().at(-1)?.id).toBe("a");
  });
  it("deduplicates calls, partial tools and persisted results by call id", () => {
    const p = new TranscriptProjector();
    const call = {
      role: "assistant",
      timestamp: 2,
      content: [{ type: "toolCall", id: "call", name: "bash" }],
    };
    p.message(call);
    p.tool({ toolCallId: "call", toolName: "bash" });
    p.tool({
      toolCallId: "call",
      toolName: "bash",
      partialResult: { content: [{ type: "text", text: "partial output" }] },
    });
    expect(p.messages()).toHaveLength(1);
    expect(p.messages()[0].text).toBe("partial output");
    p.reconcile([
      entry("a", call),
      entry("t", {
        role: "toolResult",
        toolCallId: "call",
        toolName: "bash",
        isError: true,
        content: [{ type: "text", text: "final redacted result" }],
      }),
    ]);
    expect(p.messages()).toHaveLength(1);
    expect(p.messages()[0]).toMatchObject({
      id: "tool:call",
      text: "final redacted result",
      isError: true,
    });
  });
  it("does not mirror shell/custom/system roles and preserves stopped partial text", () => {
    for (const role of ["system", "custom", "bashExecution"])
      expect(projectMessage({ role, content: "secret" }, "x")).toEqual([]);
    expect(
      projectMessage({ ...assistant("partial"), stopReason: "aborted" }, "x").map((m) => m.text),
    ).toEqual(["reason", "partial", "Agent stopped"]);
    expect(
      projectMessage(
        { ...assistant(""), stopReason: "error", errorMessage: "provider failed" },
        "x",
      ).at(-1)?.text,
    ).toBe("provider failed");
  });
  it("validates and bounds raster images rather than rendering arbitrary URLs", () => {
    const image = {
      type: "image",
      mimeType: "image/png",
      data: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString("base64"),
    };
    expect(imageUrl(image)).toMatch(/^data:image\/png;base64,/);
    expect(imageUrl({ ...image, mimeType: "image/svg+xml" })).toBeUndefined();
    expect(imageUrl({ ...image, data: "not an image" })).toBeUndefined();
    expect(imageUrl({ ...image, data: "A".repeat(180000) })).toBeUndefined();
    expect(
      projectMessage({ role: "user", content: [{ ...image, data: "bad" }] }, "u")[0].text,
    ).toContain("Image omitted");
  });
  it("bounds history, every live frame and long-running turns", () => {
    const p = new TranscriptProjector();
    p.reconcile(
      Array.from({ length: 1000 }, (_, i) => entry(String(i), assistant("x".repeat(33000), i))),
    );
    for (let i = 1000; i < 1100; i++) p.message(assistant("y".repeat(33000), i));
    expect(p.messages().length).toBeLessThanOrEqual(MAX_MESSAGES);
    expect(Buffer.byteLength(JSON.stringify(p.messages()))).toBeLessThan(
      MAX_SNAPSHOT + MAX_MESSAGES,
    );
    expect(p.truncated).toBe(true);
    p.reconcile([entry("new", { role: "user", timestamp: 0, content: "new branch" })]);
    expect(p.messages()).toHaveLength(1);
  });
});
