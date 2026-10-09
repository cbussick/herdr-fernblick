import { afterEach, expect, it, vi } from "vitest";
import { boardApi } from "./boardApi";
import { ApiError } from "../../shared/api/apiClient";
import { board, target } from "./testFixtures";

const id = "33333333-3333-4333-8333-333333333333";
const input = {
  target,
  boardId: board().id,
  revision: 1,
  uploadId: `${id}.png`,
  mode: "image" as const,
  text: "",
  requestId: id,
};
afterEach(() => vi.unstubAllGlobals());
it("uses the fixed board endpoint and validates returned scenes", async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(board()), { status: 200 }));
  vi.stubGlobal("fetch", fetch);
  expect(await boardApi.open("w:p", target)).toEqual(board());
  expect(fetch).toHaveBeenCalledWith(
    "/api/agents/w%3Ap/board",
    expect.objectContaining({ method: "POST", body: JSON.stringify({ target }) }),
  );
  fetch.mockResolvedValue(new Response(JSON.stringify({ revision: 1 })));
  await expect(boardApi.open("w:p", target)).rejects.toThrow();
});
it.each([
  { type: "ack", id: "44444444-4444-4444-8444-444444444444", outcome: "invoked" },
  { ok: true },
  { type: "ack", id, outcome: "rejected", reason: "busy" },
])(
  "accepts only a matching invoked ACK and never retries malformed/rejected replies",
  async (body) => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(body)));
    vi.stubGlobal("fetch", fetch);
    await expect(boardApi.send("pane", input)).rejects.toThrow();
    expect(fetch).toHaveBeenCalledOnce();
  },
);
it("never retries an uncertain send", async () => {
  const fetch = vi.fn().mockRejectedValue(new TypeError("offline"));
  vi.stubGlobal("fetch", fetch);
  await expect(boardApi.send("pane", input)).rejects.toThrow("Delivery uncertain");
  expect(fetch).toHaveBeenCalledOnce();
});
it("preserves ApiError status for CAS conflicts and explains missing endpoints", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "stale revision" }), { status: 409 }),
      )
      .mockResolvedValueOnce(new Response("not found", { status: 404 })),
  );
  await expect(
    boardApi.save("pane", { target, boardId: board().id, baseRevision: 1, scene: board().scene }),
  ).rejects.toMatchObject({ status: 409 });
  await expect(boardApi.open("pane", target)).rejects.toBeInstanceOf(ApiError);
});
it.each([true, false])(
  "sends a board prompt with optional visual context (%s) and checks its ACK",
  async (withImage) => {
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ type: "ack", id, outcome: "invoked" })));
    vi.stubGlobal("fetch", fetch);
    const prompt = {
      target,
      boardId: input.boardId,
      revision: 1,
      text: "Finish this",
      requestId: id,
      ...(withImage ? { uploadId: input.uploadId } : {}),
    };
    await boardApi.prompt("pane", prompt);
    expect(fetch).toHaveBeenCalledWith(
      "/api/agents/pane/board/prompt",
      expect.objectContaining({ body: JSON.stringify(prompt) }),
    );
  },
);
it("validates SSE hints, carries all target fields, and closes the stream", () => {
  class Source {
    static instance: Source;
    url: string;
    onmessage?: (event: { data: string }) => void;
    onerror?: () => void;
    close = vi.fn();
    constructor(url: string) {
      this.url = url;
      Source.instance = this;
    }
  }
  vi.stubGlobal("EventSource", Source);
  const event = vi.fn();
  const disconnected = vi.fn();
  const close = boardApi.events("w:p", target, event, disconnected);
  expect(Source.instance.url).toContain(
    `runtime=${target.runtime}&epoch=${target.epoch}&sessionId=session-a`,
  );
  Source.instance.onmessage!({
    data: JSON.stringify({ type: "changed", revision: 2, access: null, lastAuthor: "agent" }),
  });
  expect(event).toHaveBeenCalledWith({
    type: "changed",
    revision: 2,
    access: null,
    lastAuthor: "agent",
  });
  Source.instance.onmessage!({ data: "{broken" });
  expect(disconnected).toHaveBeenCalledOnce();
  close();
  expect(Source.instance.close).toHaveBeenCalledOnce();
});
