import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getAgentTreePage } from "./apiClient";
import { readTreePage } from "../../../packages/pi-live-chat/treePage";
const target = { runtime: randomUUID(), epoch: randomUUID(), sessionId: "fixture" };
const page = readTreePage({ getEntries: () => [], getLeafId: () => null }, {});
const fetchMock = vi.fn();
beforeEach(() => vi.stubGlobal("fetch", fetchMock.mockReset()));
afterEach(() => vi.unstubAllGlobals());

it("requests a bounded page with the exact query, captured target and a deadline", async () => {
  fetchMock.mockResolvedValueOnce(
    Response.json({ type: "tree-page", id: randomUUID(), target, page }),
  );
  const request = { query: "whole session", filter: "user" as const };
  expect(await getAgentTreePage("w1:p1", target, request)).toEqual(page);
  expect(fetchMock.mock.calls[0][0]).toBe("/api/agents/w1%3Ap1/tree-page");
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ target, page: request });
  expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
});
it.each(["runtime", "epoch", "sessionId"])("rejects responses for a replaced %s", async (field) => {
  fetchMock.mockResolvedValueOnce(
    Response.json({
      type: "tree-page",
      id: randomUUID(),
      target: { ...target, [field]: randomUUID() },
      page,
    }),
  );
  await expect(getAgentTreePage("w1:p1", target, {})).rejects.toThrow("session changed");
  expect(fetchMock).toHaveBeenCalledOnce();
});
it.each(["oversized", "byte-budget", "invalid-page", "network"])(
  "rejects %s results without retries",
  async (kind) => {
    const row = {
      id: "entry",
      parentId: null,
      role: "user",
      text: "hello",
      textTruncated: false,
      isActivePath: false,
      childCount: 0,
    };
    if (kind === "network") fetchMock.mockRejectedValueOnce(new Error("Connection lost"));
    else
      fetchMock.mockResolvedValueOnce(
        Response.json({
          type: "tree-page",
          id: randomUUID(),
          target,
          page:
            kind === "oversized"
              ? { ...page, rows: Array(51).fill(row), total: 51 }
              : kind === "byte-budget"
                ? {
                    ...page,
                    total: 50,
                    rows: Array.from({ length: 50 }, (_, i) => ({
                      ...row,
                      id: `${i}` + String.fromCharCode(1).repeat(240),
                      parentId: String.fromCharCode(1).repeat(240),
                      text: String.fromCharCode(1).repeat(240),
                      label: String.fromCharCode(1).repeat(128),
                      timestamp: String.fromCharCode(1).repeat(64),
                    })),
                  }
                : { ...page, nextOffset: 0 },
        }),
      );
    await expect(getAgentTreePage("w1:p1", target, {})).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledOnce();
  },
);
