import { expect, it, vi } from "vitest";
import { RenderRequests } from "./renderRequests.js";

function route(url = "http://localhost/assets/app.js") {
  const response = { ok: () => true, dispose: vi.fn(async () => {}) };
  return {
    request: () => ({
      url: () => url,
      method: () => "GET",
      resourceType: () => "script",
      isNavigationRequest: () => false,
    }),
    fetch: vi.fn(async () => response),
    fulfill: vi.fn(async () => {}),
    abort: vi.fn(async () => {}),
    response,
  };
}
it("disposes fetched responses and aborts when fulfillment fails", async () => {
  const value = route();
  value.fulfill.mockRejectedValueOnce(new Error("closed"));
  await new RenderRequests("http://localhost").handle(value, false);
  expect(value.response.dispose).toHaveBeenCalledExactlyOnceWith();
  expect(value.abort).toHaveBeenCalledExactlyOnceWith("blockedbyclient");
});
it("handles fetch failure without attempting fulfillment or masking abort failure", async () => {
  const value = route();
  value.fetch.mockRejectedValueOnce(new Error("network"));
  value.abort.mockRejectedValueOnce(new Error("closed"));
  await expect(
    new RenderRequests("http://localhost").handle(value, false),
  ).resolves.toBeUndefined();
  expect(value.fulfill).not.toHaveBeenCalled();
  expect(value.response.dispose).not.toHaveBeenCalled();
});
it.each([
  "http://outside/assets/app.js",
  "http://localhost/assets/app.js?token=x",
  "http://localhost/api/boards",
  "file:///assets/app.js",
])("rejects %s before fetching", async (url) => {
  const value = route(url);
  await new RenderRequests("http://localhost").handle(value, false);
  expect(value.fetch).not.toHaveBeenCalled();
  expect(value.abort).toHaveBeenCalledExactlyOnceWith("blockedbyclient");
});
