import { expect, it, vi } from "vitest";
import type { z } from "zod";
import { HerdrRequestError, type HerdrClient } from "./HerdrClient.js";
import { HerdrService } from "./herdrService.js";

const output = {
  pane_id: "w21:p9",
  workspace_id: "w21",
  tab_id: "w21:t9",
  format: "text",
  text: "Agent is working…",
  revision: 1,
  truncated: false,
};

const historyUnavailable =
  "cannot read 600 lines while w21:p9 is working: its alternate-screen history can only be captured by scrolling while idle. Wait and retry, or use --source visible";

it.each(["agent", "pane"] as const)(
  "shows visible %s output when alternate-screen history cannot be read while working",
  async (kind) => {
    const request = vi.fn(
      async <T>(_method: string, params: Record<string, unknown>, schema: z.ZodType<T>) => {
        if (params.source === "recent_unwrapped") {
          throw new HerdrRequestError("busy", historyUnavailable);
        }
        return schema.parse({
          type: "pane_read",
          read: { ...output, source: params.source },
        });
      },
    );
    const service = new HerdrService({ request } as unknown as HerdrClient);
    const read = () =>
      kind === "agent" ? service.readAgent("w21:p9", 600) : service.readPane("w21:p9", 600);

    await expect(read()).resolves.toMatchObject({
      text: "Agent is working…",
      source: "visible",
    });
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[1]).toEqual([
      `${kind}.read`,
      {
        [kind === "agent" ? "target" : "pane_id"]: "w21:p9",
        source: "visible",
        format: "text",
        strip_ansi: true,
      },
      expect.anything(),
    ]);
  },
);

it.each(["agent", "pane"] as const)("preserves %s history when available", async (kind) => {
  const request = vi.fn(
    async <T>(_method: string, params: Record<string, unknown>, schema: z.ZodType<T>) =>
      schema.parse({ type: "pane_read", read: { ...output, source: params.source } }),
  );
  const service = new HerdrService({ request } as unknown as HerdrClient);
  const read = () =>
    kind === "agent" ? service.readAgent("w21:p9", 600) : service.readPane("w21:p9", 600);

  await expect(read()).resolves.toMatchObject({ source: "recent_unwrapped" });
  expect(request).toHaveBeenCalledTimes(1);
  expect(request.mock.calls[0][1]).toMatchObject({ source: "recent_unwrapped", lines: 600 });
});

it.each(["agent", "pane"] as const)(
  "resumes %s history reads after a visible fallback",
  async (kind) => {
    let working = true;
    const request = vi.fn(
      async <T>(_method: string, params: Record<string, unknown>, schema: z.ZodType<T>) => {
        if (working && params.source === "recent_unwrapped") {
          throw new HerdrRequestError("busy", historyUnavailable);
        }
        return schema.parse({ type: "pane_read", read: { ...output, source: params.source } });
      },
    );
    const service = new HerdrService({ request } as unknown as HerdrClient);
    const read = () =>
      kind === "agent" ? service.readAgent("w21:p9", 600) : service.readPane("w21:p9", 600);

    await expect(read()).resolves.toMatchObject({ source: "visible" });
    working = false;
    await expect(read()).resolves.toMatchObject({ source: "recent_unwrapped" });
    expect(request).toHaveBeenCalledTimes(3);
  },
);

it.each([
  new HerdrRequestError("busy", "another read is in progress; retry"),
  new HerdrRequestError("unavailable", "socket unavailable"),
  new HerdrRequestError("not_found", "pane not found"),
  new Error(historyUnavailable),
])("does not mask unrelated read errors: %s", async (error) => {
  const request = vi.fn().mockRejectedValue(error);
  const service = new HerdrService({ request } as unknown as HerdrClient);

  await expect(service.readAgent("w21:p9", 600)).rejects.toBe(error);
  expect(request).toHaveBeenCalledTimes(1);
});

it("propagates a failed visible read without retrying again", async () => {
  const error = new HerdrRequestError("not_found", "pane disappeared");
  const request = vi
    .fn()
    .mockRejectedValueOnce(new HerdrRequestError("busy", historyUnavailable))
    .mockRejectedValueOnce(error);
  const service = new HerdrService({ request } as unknown as HerdrClient);

  await expect(service.readPane("w21:p9", 600)).rejects.toBe(error);
  expect(request).toHaveBeenCalledTimes(2);
});
