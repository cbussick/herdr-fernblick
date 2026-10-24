import type { Browser, Request, Route } from "playwright";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BoardRenderer } from "./renderer.js";
import { emptyScene } from "./scene.js";

const { launch } = vi.hoisted(() => ({ launch: vi.fn() }));
vi.mock("playwright", () => ({ chromium: { launch } }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function png(width = 100, height = 100): Buffer {
  const value = Buffer.alloc(33);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(value);
  value.write("IHDR", 12);
  value.writeUInt32BE(width, 16);
  value.writeUInt32BE(height, 20);
  return value;
}
function fakeBrowser() {
  const page = {
    on: vi.fn(),
    mainFrame: () => "main-frame",
    goto: vi.fn().mockResolvedValue({ ok: () => true }),
    waitForFunction: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn().mockResolvedValue(png().toString("base64")),
  };
  const context = {
    newPage: vi.fn().mockResolvedValue(page),
    on: vi.fn(),
    route: vi.fn().mockResolvedValue(undefined),
    routeWebSocket: vi.fn().mockResolvedValue(undefined),
  };
  const browser = {
    newContext: vi.fn().mockResolvedValue(context),
    close: vi.fn().mockResolvedValue(undefined),
  };
  launch.mockResolvedValue(browser);
  return { page, context, browser };
}
const renderers: BoardRenderer[] = [];
function renderer() {
  const result = new BoardRenderer("http://127.0.0.1:9191");
  renderers.push(result);
  return result;
}
beforeEach(() => launch.mockReset());
afterEach(async () => {
  await Promise.all(renderers.splice(0).map((value) => value.close()));
  vi.useRealTimers();
});

describe("BoardRenderer", () => {
  it("is lazy, validates its origin and refuses invalid scenes before launching", async () => {
    for (const origin of [
      "file:///tmp",
      "http://user:secret@localhost",
      "http://localhost/",
      "http://localhost/api",
    ])
      expect(() => new BoardRenderer(origin)).toThrow(/origin/);
    const value = renderer();
    expect(launch).not.toHaveBeenCalled();
    await expect(
      value.render({ ...emptyScene(), background: "url(http://outside)" }),
    ).rejects.toThrow();
    expect(launch).not.toHaveBeenCalled();
  });

  it("returns a bounded PNG, detaches input, and closes its browser", async () => {
    const { browser, page, context } = fakeBrowser();
    const value = renderer();
    const scene = emptyScene();
    const result = value.render(scene);
    scene.background = "#ff0000";
    expect(await result).toEqual(png());
    await value.close();
    expect(page.evaluate.mock.calls[0][1]).toContain('"background":"#ffffff"');
    expect(context.routeWebSocket).toHaveBeenCalled();
    expect(browser.newContext).toHaveBeenCalledWith(
      expect.objectContaining({ serviceWorkers: "block", acceptDownloads: false, permissions: [] }),
    );
    expect(browser.close).toHaveBeenCalled();
  });

  it("does not report success before browser cleanup finishes", async () => {
    const { browser } = fakeBrowser();
    const cleanup = deferred<void>();
    browser.close.mockReturnValue(cleanup.promise);
    const value = renderer();
    let settled = false;
    const result = value.render(emptyScene()).then((png) => {
      settled = true;
      return png;
    });
    await vi.waitFor(() => expect(browser.close).toHaveBeenCalled());
    expect(settled).toBe(false);
    cleanup.resolve();
    expect(await result).toEqual(png());
  });

  it.each([
    ["oversized", Buffer.alloc(2 * 1024 * 1024 + 1).toString("base64")],
    ["too wide", png(2049, 1).toString("base64")],
    ["too many pixels", png(2048, 2048).toString("base64")],
    ["empty dimensions", png(0, 10).toString("base64")],
    ["invalid signature", Buffer.alloc(33).toString("base64")],
    ["arbitrary output", "not PNG"],
  ])("rejects %s output and cleans up", async (_name, output) => {
    const { page, browser } = fakeBrowser();
    page.evaluate.mockResolvedValue(output);
    const value = renderer();
    await expect(value.render(emptyScene())).rejects.toThrow(/PNG|pixel/);
    await value.close();
    expect(browser.close).toHaveBeenCalled();
  });

  it("blocks external requests, APIs, uploads, navigation and redirects; allows only render assets", async () => {
    const { context, page } = fakeBrowser();
    const value = renderer();
    await value.render(emptyScene());
    const handle = context.route.mock.calls[0][1] as (route: Route) => Promise<void>;
    async function request(url: string, type = "script", navigation = false, method = "GET") {
      const route = {
        request: () =>
          ({
            url: () => url,
            method: () => method,
            resourceType: () => type,
            isNavigationRequest: () => navigation,
            frame: () => page.mainFrame(),
          }) as unknown as Request,
        fetch: vi.fn().mockResolvedValue({
          ok: () => !url.includes("redirect"),
          dispose: vi.fn().mockResolvedValue(undefined),
        }),
        fulfill: vi.fn().mockResolvedValue(undefined),
        abort: vi.fn().mockResolvedValue(undefined),
      };
      await handle(route as unknown as Route);
      return route;
    }
    const base = "http://127.0.0.1:9191";
    expect(
      (await request(`${base}/whiteboard-render.html`, "document", true)).fulfill,
    ).toHaveBeenCalled();
    expect(
      (await request(`${base}/whiteboard-render.html`, "document", true)).abort,
    ).toHaveBeenCalled();
    for (const [path, type] of [
      ["/assets/chunk-abc.js", "script"],
      ["/excalidraw/fonts/Virgil/Virgil-Regular.woff2", "font"],
    ])
      expect((await request(`${base}${path}`, type)).fulfill).toHaveBeenCalled();
    const redirected = await request(`${base}/assets/redirect.js`);
    expect(redirected.fetch).toHaveBeenCalledWith({ maxRedirects: 0, timeout: 10_000 });
    expect(redirected.abort).toHaveBeenCalled();
    expect(redirected.fulfill).not.toHaveBeenCalled();
    for (const url of [
      "https://outside/assets/test.js",
      `${base}/api/boards`,
      `${base}/uploads/file.png`,
      `${base}/assets/test.js?api=1`,
      `${base}/`,
      "file:///etc/passwd",
      `${base}/src/main.tsx`,
    ])
      expect((await request(url)).abort).toHaveBeenCalled();
    expect(
      (await request(`${base}/assets/a.js`, "script", false, "POST")).abort,
    ).toHaveBeenCalled();
    expect((await request(`${base}/assets/a.js`, "document", true)).abort).toHaveBeenCalled();
  });

  it("serializes work, bounds its waiting queue and cancels all jobs on close", async () => {
    const { page, browser } = fakeBrowser();
    const gate = deferred<string>();
    page.evaluate.mockReturnValue(gate.promise);
    browser.close.mockImplementation(async () => gate.reject(new Error("Target closed")));
    const value = renderer();
    const results = Array.from({ length: 4 }, () =>
      value.render(emptyScene()).catch((error: Error) => error),
    );
    await expect(value.render(emptyScene())).rejects.toThrow("busy");
    await vi.waitFor(() => expect(page.evaluate).toHaveBeenCalledTimes(1));
    expect(launch).toHaveBeenCalledTimes(1);
    const closing = value.close();
    expect(value.close()).toBe(closing);
    await closing;
    expect(
      (await Promise.all(results)).every(
        (result) => result instanceof Error && /closed/.test(result.message),
      ),
    ).toBe(true);
    await expect(value.render(emptyScene())).rejects.toThrow("closed");
    expect(launch).toHaveBeenCalledTimes(1);
  });

  it("times out queued and active work, kills the browser and permits a retry", async () => {
    vi.useFakeTimers();
    const { page, browser } = fakeBrowser();
    const gate = deferred<string>();
    page.evaluate.mockReturnValue(gate.promise);
    browser.close.mockImplementation(async () => gate.reject(new Error("Target closed")));
    const value = renderer();
    const results = [value.render(emptyScene()), value.render(emptyScene())].map((result) =>
      result.catch((error: Error) => error),
    );
    await vi.advanceTimersByTimeAsync(30_000);
    expect(
      (await Promise.all(results)).every(
        (result) => result instanceof Error && /timed out/.test(result.message),
      ),
    ).toBe(true);
    expect(browser.close).toHaveBeenCalled();
    page.evaluate.mockResolvedValue(png().toString("base64"));
    expect(await value.render(emptyScene())).toEqual(png());
  });

  it("does not leak a browser whose launch finishes after shutdown", async () => {
    const { browser } = fakeBrowser();
    const gate = deferred<Browser>();
    launch.mockReturnValue(gate.promise);
    const value = renderer();
    const result = value.render(emptyScene()).catch((error: Error) => error);
    const closing = value.close();
    gate.resolve(browser as unknown as Browser);
    await closing;
    expect(await result).toBeInstanceOf(Error);
    expect(browser.newContext).not.toHaveBeenCalled();
    expect(browser.close).toHaveBeenCalled();
  });

  it("cleans up page failures and can render subsequent scenes", async () => {
    const { page, browser } = fakeBrowser();
    page.goto.mockRejectedValueOnce(new Error("Page failed"));
    const value = renderer();
    await expect(value.render(emptyScene())).rejects.toThrow("Page failed");
    await vi.waitFor(() => expect(browser.close).toHaveBeenCalled());
    expect(await value.render(emptyScene())).toEqual(png());
  });
});
