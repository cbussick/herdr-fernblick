import { chromium, type Browser, type Request } from "playwright";
import type { BoardScene } from "../../packages/pi-live-chat/boardProtocol.js";
import { validateScene } from "./scene.js";
import { validateRasterBudget } from "./rasterBudget.js";

const MAX_PNG_BYTES = 2 * 1024 * 1024;
const MAX_SIDE = 2048;
const MAX_PIXELS = 2 * 1024 * 1024;
const TIMEOUT_MS = 30_000;
const MAX_PENDING = 4; // Includes the active render.
const pngMagic = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

type RenderFunction = { renderBoardScene: (scene: BoardScene) => Promise<string> };
type Job = {
  scene: BoardScene;
  resolve: (png: Buffer) => void;
  reject: (error: Error) => void;
  controller: AbortController;
  deadline: number;
  timer: ReturnType<typeof setTimeout>;
};

// Only the built dedicated document and its bundled scripts/fonts are reachable.
// No general same-origin allowlist: board/API/upload endpoints are off limits too.
function allowedAsset(request: Request, origin: string): boolean {
  const url = new URL(request.url());
  if (url.origin !== origin || request.method() !== "GET" || url.search) return false;
  const path = url.pathname;
  return (
    (request.resourceType() === "script" && /^\/assets\/[\w.-]+\.js$/.test(path)) ||
    (request.resourceType() === "font" && /^\/excalidraw\/fonts\/[\w./-]+\.woff2$/.test(path))
  );
}

function decodePng(value: unknown): Buffer {
  if (
    typeof value !== "string" ||
    value.length > Math.ceil(MAX_PNG_BYTES / 3) * 4 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(value)
  )
    throw new Error("Board renderer returned an invalid or oversized PNG");
  const png = Buffer.from(value, "base64");
  if (
    png.length < 33 ||
    png.length > MAX_PNG_BYTES ||
    png.toString("base64") !== value ||
    !png.subarray(0, 8).equals(pngMagic) ||
    png.toString("ascii", 12, 16) !== "IHDR"
  )
    throw new Error("Board renderer returned an invalid or oversized PNG");
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  if (!width || !height || width > MAX_SIDE || height > MAX_SIDE || width * height > MAX_PIXELS)
    throw new Error("Board renderer exceeded the pixel limit");
  return png;
}

/** On-demand native Excalidraw exports, independent of any user's browser/editor.
 * The origin must serve a production Vite build. No browser launches until render().
 * Each job gets a fresh browser (no cookies, caches or scene state survive a job).
 */
export class BoardRenderer {
  readonly #origin: string;
  #closed = false;
  #queue: Job[] = [];
  #active?: { job: Job; done: Promise<void> };
  #closing?: Promise<void>;

  constructor(origin: string) {
    const url = new URL(origin);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.origin !== origin)
      throw new Error("Board renderer requires an HTTP(S) origin without a path");
    this.#origin = origin;
  }

  render(scene: BoardScene): Promise<Buffer> {
    if (this.#closed) return Promise.reject(new Error("Board renderer is closed"));
    if (this.#queue.length + (this.#active ? 1 : 0) >= MAX_PENDING)
      return Promise.reject(new Error("Board renderer is busy"));
    let snapshot: BoardScene;
    try {
      snapshot = validateScene(scene);
      validateRasterBudget(snapshot);
    } catch (error) {
      return Promise.reject(error);
    }
    return new Promise((resolve, reject) => {
      const controller = new AbortController();
      const job: Job = {
        scene: snapshot,
        resolve,
        reject,
        controller,
        deadline: Date.now() + TIMEOUT_MS,
        timer: setTimeout(() => {
          this.#queue = this.#queue.filter((queued) => queued !== job);
          const error = new Error("Board rendering timed out");
          reject(error);
          controller.abort(error);
        }, TIMEOUT_MS),
      };
      this.#queue.push(job);
      this.#pump();
    });
  }

  #pump(): void {
    if (this.#closed || this.#active) return;
    const job = this.#queue.shift();
    if (!job) return;
    if (Date.now() >= job.deadline) {
      clearTimeout(job.timer);
      const error = new Error("Board rendering timed out");
      job.reject(error);
      job.controller.abort(error);
      this.#pump();
      return;
    }
    const done = this.#run(job).finally(() => {
      this.#active = undefined;
      this.#pump();
    });
    this.#active = { job, done };
  }

  async #run(job: Job): Promise<void> {
    let browser: Browser | undefined;
    let output: Buffer | undefined;
    let failure: Error | undefined;
    const signal = job.controller.signal;
    const abort = () => {
      // Closing the process also interrupts CPU-bound page.evaluate work.
      void browser?.close().catch(() => {});
    };
    signal.addEventListener("abort", abort, { once: true });
    try {
      browser = await chromium.launch({ headless: true, timeout: 10_000 });
      signal.throwIfAborted();
      const context = await browser.newContext({
        acceptDownloads: false,
        serviceWorkers: "block",
        permissions: [],
        javaScriptEnabled: true,
        viewport: { width: 800, height: 600 },
      });
      signal.throwIfAborted();
      const page = await context.newPage();
      page.on("dialog", (dialog) => void dialog.dismiss().catch(() => {}));
      context.on("page", (popup) => {
        if (popup !== page) void popup.close().catch(() => {});
      });
      await context.routeWebSocket(/.*/, (socket) => socket.close());
      let documentAllowed = true;
      await context.route("**/*", async (route) => {
        const request = route.request();
        let allowed = false;
        if (
          documentAllowed &&
          request.isNavigationRequest() &&
          request.frame() === page.mainFrame() &&
          request.method() === "GET" &&
          request.url() === `${this.#origin}/whiteboard-render.html`
        ) {
          documentAllowed = false;
          allowed = true;
        } else if (!request.isNavigationRequest() && allowedAsset(request, this.#origin)) {
          allowed = true;
        }
        // route.continue() can follow redirects without re-running interception.
        // Fetch at most the allowed URL, then fulfill only a successful response.
        try {
          if (!allowed) {
            await route.abort("blockedbyclient");
            return;
          }
          const response = await route.fetch({ maxRedirects: 0, timeout: 10_000 });
          try {
            if (response.ok()) await route.fulfill({ response });
            else await route.abort("blockedbyclient");
          } finally {
            await response.dispose();
          }
        } catch {
          await route.abort("blockedbyclient").catch(() => {});
        }
      });
      const response = await page.goto(`${this.#origin}/whiteboard-render.html`, {
        waitUntil: "load",
        timeout: TIMEOUT_MS,
      });
      if (!response?.ok()) throw new Error("Board renderer entry could not load");
      await page.waitForFunction(
        () => typeof (globalThis as unknown as RenderFunction).renderBoardScene === "function",
      );
      signal.throwIfAborted();
      const result = await page.evaluate(
        (json) => (globalThis as unknown as RenderFunction).renderBoardScene(JSON.parse(json)),
        JSON.stringify(job.scene),
      );
      signal.throwIfAborted();
      output = decodePng(result);
    } catch (error) {
      failure = error instanceof Error ? error : new Error("Board rendering failed");
    } finally {
      clearTimeout(job.timer);
      signal.removeEventListener("abort", abort);
      await browser?.close().catch(() => {});
    }
    if (failure) job.reject(failure);
    else if (output) job.resolve(output);
  }

  close(): Promise<void> {
    if (this.#closing) return this.#closing;
    this.#closed = true;
    const error = new Error("Board renderer is closed");
    for (const job of [...this.#queue, ...(this.#active ? [this.#active.job] : [])]) {
      clearTimeout(job.timer);
      job.reject(error);
      job.controller.abort(error);
    }
    this.#queue = [];
    this.#closing = this.#active?.done ?? Promise.resolve();
    return this.#closing;
  }
}
