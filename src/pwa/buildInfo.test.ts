import { afterEach, expect, it, vi } from "vitest";
import { fetchLatestBuild, sameBuild } from "./buildInfo";

afterEach(() => vi.unstubAllGlobals());
const latest = { revision: "a".repeat(40), builtAt: "2026-10-24T11:00:00.000Z" };

it("fetches deployment metadata from the network, never the browser cache", async () => {
  const fetchMock = vi.fn().mockResolvedValue(Response.json(latest));
  vi.stubGlobal("fetch", fetchMock);
  expect(await fetchLatestBuild()).toEqual(latest);
  expect(fetchMock).toHaveBeenCalledWith(
    "/version.json",
    expect.objectContaining({ cache: "no-store" }),
  );
});

it.each([
  Response.json({}, { status: 503 }),
  Response.json({ revision: "not a build", builtAt: latest.builtAt }),
  new Response("<html>Old server fallback</html>"),
])("does not mistake a failed/malformed metadata response for up to date", async (response) => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
  await expect(fetchLatestBuild()).rejects.toThrow();
});

it("distinguishes rebuilds of the same commit as well as different commits", () => {
  expect(sameBuild(latest, { ...latest })).toBe(true);
  expect(sameBuild(latest, { ...latest, builtAt: "2026-10-24T12:00:00.000Z" })).toBe(false);
  expect(sameBuild(latest, { ...latest, revision: "b".repeat(40) })).toBe(false);
});
