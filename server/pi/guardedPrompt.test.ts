import { expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { z } from "zod";
import type { HerdrClient } from "../herdr/HerdrClient.js";
import { HerdrService } from "../herdr/herdrService.js";
import { QueueStore } from "../queue/queueStore.js";
import { encodeGuardedPrompt } from "./guardedPrompt.js";
import fernblickPiExtension from "./fernblickPiExtension.js";

type Handler = Parameters<
  Parameters<typeof fernblickPiExtension>[0]["registerCommand"]
>[1]["handler"];

function harness() {
  const handlers = new Map<string, Handler>();
  const sendUserMessage = vi.fn();
  fernblickPiExtension({
    sendUserMessage,
    registerCommand: (name, command) => handlers.set(name, command.handler),
  });
  const deliver = handlers.get("fernblick-deliver")!;
  const context = {
    sessionManager: { getSessionFile: () => "/sessions/original.jsonl", getEntries: () => [] },
    isIdle: () => true,
    waitForIdle: async () => {},
    navigateTree: async () => {},
  };
  return { deliver, context, sendUserMessage };
}

function queued(text: string) {
  const dir = mkdtempSync(join(tmpdir(), "fernblick-guard-test-"));
  const store = new QueueStore(join(dir, "queue.sqlite"));
  const item = store.create("w1:p1", "/sessions/original.jsonl", {
    requestId: "a".repeat(32),
    text,
    attachments: [],
  })!;
  store.claim("w1:p1", "/sessions/original.jsonl", 1);
  const encoded = encodeGuardedPrompt({
    id: item.id,
    expectedSession: item.session,
    dbPath: store.path,
  }).split(" ")[1];
  return {
    encoded,
    item,
    store,
    cleanup: () => {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

it("loads the claimed message, checks Pi's session, and rejects replacement sessions", async () => {
  const fixture = queued("Hi");
  try {
    const { deliver, context, sendUserMessage } = harness();
    await deliver(fixture.encoded, context);
    expect(sendUserMessage).toHaveBeenCalledWith("Hi", undefined);
    await expect(
      deliver(fixture.encoded, {
        ...context,
        sessionManager: {
          ...context.sessionManager,
          getSessionFile: () => "/sessions/replacement.jsonl",
        },
      }),
    ).rejects.toThrow("different Pi session");
    expect(sendUserMessage).toHaveBeenCalledTimes(1);
    await expect(deliver("invalid!", context)).rejects.toThrow("Invalid Fernblick delivery token");
    fixture.store.transition(fixture.item.id, "sending", "uncertain");
    await expect(deliver(fixture.encoded, context)).rejects.toThrow("no longer available");
  } finally {
    fixture.cleanup();
  }
});

it("queues in Pi if the agent became busy, without sending a long terminal command", async () => {
  const fixture = queued("x".repeat(32_000));
  try {
    const { deliver, context, sendUserMessage } = harness();
    expect(fixture.encoded.length).toBeLessThan(600);
    await deliver(fixture.encoded, { ...context, isIdle: () => false });
    expect(sendUserMessage).toHaveBeenCalledWith("x".repeat(32_000), { deliverAs: "followUp" });
  } finally {
    fixture.cleanup();
  }
});

it("routes only a short ID through Pi's interactive slash-command path, not agent.prompt", async () => {
  const request = vi.fn(async <T>(_method: string, _params: unknown, schema: z.ZodType<T>) =>
    schema.parse({ type: "ok" }),
  );
  const service = new HerdrService({ request } as unknown as HerdrClient);
  const payload = {
    id: "12345678-1234-1234-1234-123456789abc",
    expectedSession: "/sessions/original.jsonl",
    dbPath: "/tmp/queue.sqlite",
  };
  await service.promptAgentGuarded("w1:p2", payload.expectedSession, payload.id, payload.dbPath);
  expect(request).toHaveBeenCalledWith(
    "pane.send_input",
    {
      pane_id: "w1:p2",
      text: encodeGuardedPrompt(payload),
      keys: ["enter"],
    },
    expect.anything(),
  );
  expect(request).not.toHaveBeenCalledWith("agent.prompt", expect.anything(), expect.anything());
});
