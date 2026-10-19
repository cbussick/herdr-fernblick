import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  precache: vi.fn(),
  handler: vi.fn(() => "app-shell"),
  navigation: vi.fn(function (handler, options) {
    return { handler, options };
  }),
  route: vi.fn(),
}));
vi.mock("workbox-precaching", () => ({
  precacheAndRoute: mocks.precache,
  createHandlerBoundToURL: mocks.handler,
}));
vi.mock("workbox-routing", () => ({
  NavigationRoute: mocks.navigation,
  registerRoute: mocks.route,
}));
afterEach(() => vi.unstubAllGlobals());

it("precaches only build assets, handles only app navigation, and waits for explicit activation", async () => {
  const worker = Object.assign(new EventTarget(), {
    __WB_MANIFEST: [{ url: "index.html", revision: "v1" }],
    skipWaiting: vi.fn(),
  });
  vi.stubGlobal("self", worker);
  await import("./sw");
  expect(mocks.precache).toHaveBeenCalledWith(worker.__WB_MANIFEST);
  expect(mocks.route).toHaveBeenCalledTimes(1);
  const options = mocks.navigation.mock.calls[0][1] as { allowlist: RegExp[] };
  const matches = (path: string) => options.allowlist.some((rule) => rule.test(path));
  expect(matches("/")).toBe(true);
  expect(matches("/?agent=one")).toBe(true);
  expect(matches("/index.html")).toBe(true);
  for (const path of ["/api/agents", "/api/images/private.png", "/api/live/events", "/unknown"]) {
    expect(matches(path)).toBe(false);
  }
  expect(worker.skipWaiting).not.toHaveBeenCalled();
  worker.dispatchEvent(new MessageEvent("message", { data: { type: "OTHER" } }));
  expect(worker.skipWaiting).not.toHaveBeenCalled();
  worker.dispatchEvent(new MessageEvent("message", { data: { type: "SKIP_WAITING" } }));
  expect(worker.skipWaiting).toHaveBeenCalledOnce();
});
