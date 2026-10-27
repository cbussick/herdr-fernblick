import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  chatCommand,
  markAgentRead,
  moveWorkspace,
  compactAgentConversation,
  getAgentSkills,
  getAgentModels,
  setAgentModel,
  getAgentThinkingLevels,
  setAgentThinkingLevel,
  saveAgentGlobalDefault,
  getAgentOutput,
  getPaneOutput,
  ApiError,
} from "./apiClient";
it("posts a validated relative workspace move and preserves API failures", async () => {
  const input = { workspaceId: "w3", beforeWorkspaceId: "w1" };
  fetchMock.mockResolvedValueOnce(Response.json({ ok: true }));
  await moveWorkspace(input);
  expect(fetchMock.mock.calls[0][0]).toBe("/api/workspaces/move");
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual(input);
  expect(fetchMock.mock.calls[0][1].signal).toBe(controller.signal);
  fetchMock.mockResolvedValueOnce(Response.json({ error: "Missing workspace" }, { status: 502 }));
  await expect(moveWorkspace(input)).rejects.toThrow("Missing workspace");
  await expect(moveWorkspace({ workspaceId: "w1", beforeWorkspaceId: "w1" })).rejects.toThrow();
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

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
it.each([getAgentOutput, getPaneOutput])(
  "requests visible output by default and history explicitly",
  async (getOutput) => {
    const output = {
      pane_id: "w1:p1",
      tab_id: "w1:t1",
      workspace_id: "w1",
      revision: 1,
      source: "visible",
      format: "text",
      text: "screen",
      truncated: false,
    };
    fetchMock.mockImplementation(async () => Response.json(output));
    await getOutput("w1:p1");
    expect(fetchMock.mock.calls[0][0]).toContain("/w1%3Ap1/output?source=visible&lines=600");
    await getOutput("w1:p1", "recent_unwrapped", controller.signal);
    expect(fetchMock.mock.calls[1][0]).toContain("source=recent_unwrapped&lines=600");
    expect(fetchMock.mock.calls[1][1].signal).toBe(controller.signal);
  },
);

it("sends only a completion receipt and requires confirmation before displaying read", async () => {
  const input = { paneId: "w1:p1", completionId: "a".repeat(64) };
  fetchMock.mockResolvedValueOnce(Response.json({ ok: true }));
  await markAgentRead(input);
  expect(fetchMock.mock.calls[0][0]).toBe("/api/agents/w1%3Ap1/read");
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ completionId: input.completionId });
  expect(fetchMock.mock.calls[0][1].keepalive).toBe(true);
  fetchMock.mockResolvedValueOnce(Response.json({ ok: false }));
  await expect(markAgentRead(input)).rejects.toThrow();
  fetchMock.mockResolvedValueOnce(Response.json({ error: "Answer changed" }, { status: 409 }));
  await expect(markAgentRead(input)).rejects.toMatchObject({ status: 409 });
});

it("requires confirmed compaction for the current target, not a forwarding ACK", async () => {
  const reply = { type: "compacted", id: randomUUID(), target };
  fetchMock.mockResolvedValueOnce(Response.json(reply));
  expect(await compactAgentConversation("w1:p1", target)).toEqual(reply);
  expect(fetchMock.mock.calls[0][0]).toBe("/api/agents/w1%3Ap1/compact");
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ target });
  expect(AbortSignal.timeout).toHaveBeenCalledWith(125_000);
  for (const invalid of [
    { type: "ack", id: randomUUID(), outcome: "invoked" },
    { ...reply, target: { ...target, epoch: randomUUID() } },
    { ...reply, target: { ...target, sessionId: "other" } },
  ]) {
    fetchMock.mockResolvedValueOnce(Response.json(invalid));
    await expect(compactAgentConversation("w1:p1", target)).rejects.toThrow("confirmation");
  }
});

it("does not retry failed, timed-out or disconnected compaction", async () => {
  fetchMock.mockResolvedValueOnce(Response.json({ error: "Nothing to compact" }, { status: 409 }));
  await expect(compactAgentConversation("w1:p1", target)).rejects.toThrow("Nothing to compact");
  fetchMock.mockRejectedValueOnce(new TypeError("Connection lost"));
  await expect(compactAgentConversation("w1:p1", target)).rejects.toThrow("uncertain");
  fetchMock.mockImplementationOnce(
    (_url, init) =>
      new Promise((_done, reject) =>
        init.signal.addEventListener("abort", () => reject(init.signal.reason)),
      ),
  );
  const pending = compactAgentConversation("w1:p1", target);
  const assertion = expect(pending).rejects.toThrow("uncertain");
  controller.abort();
  await assertion;
  expect(fetchMock).toHaveBeenCalledTimes(3);
});

it("accepts only a skills catalogue for the requested session identity", async () => {
  const reply = { type: "skills", id: randomUUID(), target, skills: [], truncated: false };
  fetchMock.mockResolvedValueOnce(Response.json(reply));
  expect(await getAgentSkills("w1:p1", target, controller.signal)).toEqual(reply);
  expect(fetchMock.mock.calls[0][1].signal).toBe(controller.signal);
  fetchMock.mockResolvedValueOnce(
    Response.json({ ...reply, target: { ...target, epoch: randomUUID() } }),
  );
  await expect(getAgentSkills("w1:p1", target)).rejects.toThrow("session changed");
});
it("requires a bounded same-target model catalogue and matching model-change confirmation", async () => {
  const model = { id: "sonnet", provider: "anthropic", name: "Sonnet" };
  const catalogue = {
    type: "models",
    id: randomUUID(),
    target,
    models: [model],
    truncated: false,
    defaults: { model: { provider: "other", modelId: "other" }, thinkingLevel: null },
  };
  fetchMock.mockResolvedValueOnce(Response.json(catalogue));
  expect(await getAgentModels("w1:p1", target, controller.signal)).toEqual(catalogue);
  expect(fetchMock.mock.calls[0][0]).toBe("/api/agents/w1%3Ap1/models");
  expect(fetchMock.mock.calls[0][1].signal).toBe(controller.signal);
  fetchMock.mockResolvedValueOnce(
    Response.json({ ...catalogue, target: { ...target, epoch: randomUUID() } }),
  );
  await expect(getAgentModels("w1:p1", target)).rejects.toThrow("session changed");
  const reply = { type: "model-changed", id: randomUUID(), target, model };
  fetchMock.mockResolvedValueOnce(Response.json(reply));
  expect(await setAgentModel("w1:p1", target, model.provider, model.id)).toEqual(reply);
  expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({
    target,
    provider: model.provider,
    modelId: model.id,
  });
  for (const invalid of [
    { type: "ack", id: randomUUID(), outcome: "invoked" },
    { ...reply, model: { ...model, provider: "other" } },
    { ...reply, target: { ...target, epoch: randomUUID() } },
  ]) {
    fetchMock.mockResolvedValueOnce(Response.json(invalid));
    await expect(setAgentModel("w1:p1", target, model.provider, model.id)).rejects.toThrow(
      "confirmation",
    );
  }
});
it("validates thinking discovery and exact target/model/level completion", async () => {
  const selection = { provider: "anthropic", modelId: "sonnet", level: "high" as const };
  const catalogue = {
    type: "thinking-levels",
    id: randomUUID(),
    target,
    ...selection,
    levels: ["low", "medium", "high"],
    defaults: { model: null, thinkingLevel: "low" },
  };
  fetchMock.mockResolvedValueOnce(Response.json(catalogue));
  expect(await getAgentThinkingLevels("w1:p1", target, controller.signal)).toEqual(catalogue);
  expect(fetchMock.mock.calls[0][1].signal).toBe(controller.signal);
  fetchMock.mockResolvedValueOnce(
    Response.json({ ...catalogue, target: { ...target, epoch: randomUUID() } }),
  );
  await expect(getAgentThinkingLevels("w1:p1", target)).rejects.toThrow("session changed");
  const reply = { type: "thinking-level-changed", id: randomUUID(), target, ...selection };
  fetchMock.mockResolvedValueOnce(Response.json(reply));
  expect(
    await setAgentThinkingLevel("w1:p1", target, selection.provider, selection.modelId, "high"),
  ).toEqual(reply);
  expect(fetchMock.mock.calls[2][0]).toBe("/api/agents/w1%3Ap1/set-thinking-level");
  expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({ target, ...selection });
  for (const invalid of [
    { type: "ack", id: randomUUID(), outcome: "invoked" },
    { ...reply, level: "low" },
    { ...reply, modelId: "other" },
    { ...reply, target: { ...target, sessionId: "other" } },
  ]) {
    fetchMock.mockResolvedValueOnce(Response.json(invalid));
    await expect(
      setAgentThinkingLevel("w1:p1", target, selection.provider, selection.modelId, "high"),
    ).rejects.toThrow("confirmation");
  }
  fetchMock.mockRejectedValueOnce(new TypeError("Disconnected"));
  await expect(
    setAgentThinkingLevel("w1:p1", target, selection.provider, selection.modelId, "high"),
  ).rejects.toThrow("uncertain");
  expect(fetchMock).toHaveBeenCalledTimes(8);
});
it.each(["model", "thinking"] as const)(
  "validates exact %s default-save confirmations and never retries",
  async (kind) => {
    const selection =
      kind === "model"
        ? { kind, provider: "provider", modelId: "model" }
        : { kind, provider: "provider", modelId: "model", level: "high" as const };
    const reply = { type: "default-saved", id: randomUUID(), target, selection };
    fetchMock.mockResolvedValueOnce(Response.json(reply));
    expect(await saveAgentGlobalDefault("w1:p1", target, selection)).toEqual(reply);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/agents/w1%3Ap1/save-default");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ target, selection });
    for (const invalid of [
      { type: "ack", id: randomUUID(), outcome: "invoked" },
      { ...reply, target: { ...target, epoch: randomUUID() } },
      { ...reply, selection: { ...selection, provider: "other" } },
      { ...reply, selection: { ...selection, modelId: "other" } },
      {
        ...reply,
        selection: { ...selection, kind: kind === "model" ? "thinking" : "model", level: "low" },
      },
      ...(kind === "thinking" ? [{ ...reply, selection: { ...selection, level: "low" } }] : []),
    ]) {
      fetchMock.mockResolvedValueOnce(Response.json(invalid));
      await expect(saveAgentGlobalDefault("w1:p1", target, selection)).rejects.toThrow(
        "confirmation",
      );
    }
    fetchMock.mockClear().mockRejectedValueOnce(new TypeError("Disconnected"));
    await expect(saveAgentGlobalDefault("w1:p1", target, selection)).rejects.toThrow("uncertain");
    expect(fetchMock).toHaveBeenCalledOnce();
    fetchMock.mockResolvedValueOnce(Response.json({ error: "Settings invalid" }, { status: 409 }));
    await expect(saveAgentGlobalDefault("w1:p1", target, selection)).rejects.toThrow(
      "Settings invalid",
    );
  },
);
it("never retries uncertain model switches", async () => {
  fetchMock.mockRejectedValueOnce(new TypeError("Disconnected"));
  await expect(setAgentModel("w1:p1", target, "provider", "model")).rejects.toThrow("uncertain");
  expect(fetchMock).toHaveBeenCalledOnce();
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
