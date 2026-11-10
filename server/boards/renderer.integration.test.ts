import { createServer, type Server } from "node:http";
import { defaultFlowProps } from "../../packages/pi-live-chat/flowProtocol.js";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { build } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { BoardElement, BoardScene } from "../../packages/pi-live-chat/boardProtocol.js";
import { BoardRenderer } from "./renderer.js";
import { emptyScene } from "./scene.js";

let directory: string;
let server: Server;
let inspector: Browser;
let page: Page;
let renderer: BoardRenderer;
const requests: string[] = [];
const fontPaths: string[] = [];
let hostileScript: string | undefined;
let redirectEntry: string | undefined;
let redirectAsset: string | undefined;
let denyFonts = false;

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "fb-board-render-"));
  // Build an isolated real browser entry, even when npm test runs before build.
  // No backend, Herdr socket, stored board or live agent is involved.
  await build({
    configFile: false,
    logLevel: "silent",
    build: {
      outDir: directory,
      rolldownOptions: {
        input: "flow-board-render.html",
      },
    },
  });
  server = createServer(async (request, response) => {
    const path = new URL(request.url!, "http://localhost").pathname;
    requests.push(path);
    if (path.endsWith(".woff2")) {
      fontPaths.push(path);
      if (denyFonts) {
        response.writeHead(404).end();
        return;
      }
    }
    if (path === "/flow-board-render.html" && redirectEntry) {
      response.writeHead(302, { Location: redirectEntry }).end();
      return;
    }
    if (path === "/flow-board-render.html" && hostileScript) {
      response.writeHead(200, { "Content-Type": "text/html" });
      response.end('<script type="module" src="/assets/probe.js"></script>');
      return;
    }
    if (path === "/assets/probe.js" && hostileScript) {
      response.writeHead(200, { "Content-Type": "text/javascript" }).end(hostileScript);
      return;
    }
    if (path === "/assets/redirect.js" && redirectAsset) {
      response.writeHead(302, { Location: redirectAsset }).end();
      return;
    }
    try {
      if (path.includes("..")) throw new Error("Invalid path");
      const data = await readFile(join(directory, path));
      const mime: Record<string, string> = {
        ".html": "text/html",
        ".js": "text/javascript",
        ".css": "text/css",
        ".woff2": "font/woff2",
      };
      response.writeHead(200, {
        "Content-Type": mime[extname(path)] ?? "application/octet-stream",
      });
      response.end(data);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No test address");
  renderer = new BoardRenderer(`http://127.0.0.1:${address.port}`);
  inspector = await chromium.launch({ headless: true });
  page = await inspector.newPage();
}, 60_000);

afterAll(async () => {
  await renderer?.close();
  await inspector?.close();
  if (server)
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  if (directory) await rm(directory, { recursive: true, force: true });
});

function element(id: string, x = 0, y = 0, props = {}, width = 300, height = 180): BoardElement {
  return {
    id,
    type: "component",
    kind: "card",
    x,
    y,
    width,
    height,
    version: 1,
    parentId: null,
    props: { ...defaultFlowProps("card"), ...props },
  };
}
async function inspect(png: Buffer) {
  return page.evaluate(
    async (dataURL) => {
      const image = new Image();
      image.src = dataURL;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(image, 0, 0);
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      let red = 0,
        blue = 0,
        green = 0,
        dark = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i] > 200 && data[i + 1] < 60 && data[i + 2] < 60) red++;
        if (data[i] < 60 && data[i + 1] < 60 && data[i + 2] > 200) blue++;
        if (data[i] < 60 && data[i + 1] > 150 && data[i + 2] < 60) green++;
        if (data[i] < 80 && data[i + 1] < 80 && data[i + 2] < 80) dark++;
      }
      return {
        width: canvas.width,
        height: canvas.height,
        red,
        blue,
        green,
        dark,
        corner: Array.from(data.slice(0, 4)),
      };
    },
    `data:image/png;base64,${png.toString("base64")}`,
  );
}
async function raster(noise = false): Promise<string> {
  return page.evaluate((noise) => {
    const canvas = document.createElement("canvas");
    canvas.width = noise ? 600 : 20;
    canvas.height = noise ? 600 : 20;
    const ctx = canvas.getContext("2d")!;
    if (noise) {
      const pixels = ctx.createImageData(canvas.width, canvas.height);
      let seed = 123;
      for (let i = 0; i < pixels.data.length; i += 4) {
        for (let c = 0; c < 3; c++) {
          seed ^= seed << 13;
          seed ^= seed >>> 17;
          seed ^= seed << 5;
          pixels.data[i + c] = seed & 255;
        }
        pixels.data[i + 3] = 255;
      }
      ctx.putImageData(pixels, 0, 0);
    } else {
      ctx.fillStyle = "#0000ff";
      ctx.fillRect(0, 0, 20, 20);
    }
    return canvas.toDataURL("image/png");
  }, noise);
}

describe("structured browser board rendering", () => {
  it("renders downloadable PNGs at the selected resolution", async () => {
    const scene: BoardScene = {
      ...emptyScene(),
      elements: [element("card", 0, 0, { title: "Download resolution" }, 600, 400)],
    };
    const normal = await renderer.render(scene, "standard");
    const high = await renderer.render(scene, "high");
    expect(high.readUInt32BE(16)).toBeGreaterThanOrEqual(normal.readUInt32BE(16) * 2 - 1);
    expect(high.readUInt32BE(20)).toBeGreaterThanOrEqual(normal.readUInt32BE(20) * 2 - 1);
    expect(high.readUInt32BE(16)).toBeLessThanOrEqual(4096);
    expect(high.length).toBeLessThanOrEqual(16 * 1024 * 1024);
  }, 30_000);
  it("renders real flow components, ink and local images within pixel and byte limits", async () => {
    const scene: BoardScene = {
      ...emptyScene(),
      elements: [
        {
          id: "card",
          type: "component",
          kind: "card",
          x: 0,
          y: 0,
          width: 300,
          height: 200,
          version: 1,
          parentId: null,
          props: {
            ...defaultFlowProps("card"),
            title: "Flow backend integration",
            imageId: "blue",
          },
        },
        {
          id: "ink",
          type: "ink",
          x: 0,
          y: 220,
          width: 300,
          height: 100,
          version: 1,
          props: {
            points: [
              [0, 0, 1],
              [150, 50, 1],
              [300, 0, 1],
            ],
            color: "#ff0000",
            size: 12,
            pressure: false,
            w: 300,
            h: 100,
          },
        },
      ],
      files: { blue: { id: "blue", mimeType: "image/png", dataURL: await raster(), created: 0 } },
    };
    const png = await renderer.render(scene);
    const pixels = await inspect(png);
    expect(png.length).toBeLessThanOrEqual(2 * 1024 * 1024);
    expect(pixels.width).toBeLessThanOrEqual(2048);
    expect(pixels.height).toBeLessThanOrEqual(2048);
    expect(pixels.width * pixels.height).toBeLessThanOrEqual(2 * 1024 * 1024);
    expect(pixels.red).toBeGreaterThan(100);
    expect(pixels.blue).toBeGreaterThan(20);
    expect(pixels.dark).toBeGreaterThan(20);
    expect(requests).toContain("/flow-board-render.html");
  });
  it("prevents real external/API traffic and redirect escapes even without the entry CSP", async () => {
    let escaped = 0;
    const outside = createServer((_request, response) => {
      escaped++;
      response.end("escaped");
    });
    await new Promise<void>((resolve) => outside.listen(0, "127.0.0.1", resolve));
    const address = outside.address();
    if (!address || typeof address === "string") throw new Error("No outside address");
    const external = `http://127.0.0.1:${address.port}`;
    try {
      await renderer.render(emptyScene());
      redirectAsset = `${external}/redirected-script.js`;
      // Substitute an adversarial same-origin module to test the network policy
      // independently of the production CSP and validated-scene restrictions.
      hostileScript = `
        window.prepareFlowBoardScene = async () => {
          const loadScript = (src) => new Promise(resolve => {
            const script = document.createElement('script');
            script.onload = script.onerror = resolve; script.src = src;
            document.head.append(script);
          });
          const loadImage = (src) => new Promise(resolve => {
            const image = new Image(); image.onload = image.onerror = resolve; image.src = src;
          });
          await Promise.all([
            fetch('/api/boards').catch(() => {}),
            fetch('/uploads/private.png').catch(() => {}),
            fetch(${JSON.stringify(`${external}/fetch`)}).catch(() => {}),
            loadScript(${JSON.stringify(`${external}/script.js`)}),
            loadScript('/assets/redirect.js'),
            loadImage(${JSON.stringify(`${external}/image.png`)}),
          ]);
          return { width: 100, height: 100 };
        };
      `;
      requests.length = 0;
      expect((await renderer.render(emptyScene())).length).toBeGreaterThan(33);
      expect(requests).toEqual(
        expect.arrayContaining([
          "/flow-board-render.html",
          "/assets/probe.js",
          "/assets/redirect.js",
        ]),
      );
      expect(
        requests.every(
          (path) => path === "/flow-board-render.html" || /^\/assets\/[\w.-]+\.js$/.test(path),
        ),
      ).toBe(true);
      expect(escaped).toBe(0);
      hostileScript = undefined;
      redirectEntry = `${external}/redirected-document`;
      await expect(renderer.render(emptyScene())).rejects.toThrow();
      expect(escaped).toBe(0);
    } finally {
      hostileScript = undefined;
      redirectAsset = undefined;
      redirectEntry = undefined;
      await new Promise<void>((resolve) => outside.close(() => resolve()));
    }
  }, 30_000);
  it("fails explicitly if local text fonts are missing", async () => {
    denyFonts = true;
    try {
      await expect(
        renderer.render({
          ...emptyScene(),
          elements: [element("missingfont", 0, 0, { title: "Missing local font" })],
        }),
      ).rejects.toThrow(/fonts|NetworkError/);
    } finally {
      denyFonts = false;
    }
  }, 30_000);

  it("shuts down an in-flight real browser without waiting for its pending export", async () => {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No test address");
    const closingRenderer = new BoardRenderer(`http://127.0.0.1:${address.port}`);
    hostileScript = "window.prepareFlowBoardScene = () => new Promise(() => {});";
    requests.length = 0;
    const result = closingRenderer.render(emptyScene()).catch((error: Error) => error);
    try {
      const deadline = Date.now() + 10_000;
      while (!requests.includes("/assets/probe.js")) {
        if (Date.now() > deadline) throw new Error("Browser did not load test module");
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      await closingRenderer.close();
      const error = await result;
      expect(error).toBeInstanceOf(Error);
      if (error instanceof Error) expect(error.message).toMatch(/closed/);
    } finally {
      hostileScript = undefined;
      await closingRenderer.close();
    }
  }, 30_000);

  it("renders the current scene on every call, including background-only empty boards", async () => {
    const first = await renderer.render({ ...emptyScene(), background: "#ff0000" });
    const second = await renderer.render({ ...emptyScene(), background: "#0000ff" });
    expect(first.equals(second)).toBe(false);
    expect((await inspect(first)).corner).toEqual([255, 0, 0, 255]);
    expect((await inspect(second)).corner).toEqual([0, 0, 255, 255]);
  }, 30_000);

  it("fits distant scenes within the pixel and side limits", async () => {
    const png = await renderer.render({
      ...emptyScene(),
      elements: [
        element("huge", -1000000, -1000000, {}, 100000, 100000),
        element("distant", 1000000, 1000000),
      ],
    });
    const size = await inspect(png);
    expect(Math.max(size.width, size.height)).toBeLessThanOrEqual(2048);
    expect(size.width * size.height).toBeLessThanOrEqual(2 * 1024 * 1024);
  }, 30_000);

  it("downscales high-entropy raster output to the socket-safe PNG byte limit", async () => {
    const dataURL = await raster(true);
    const png = await renderer.render({
      ...emptyScene(),
      elements: [element("noise", 0, 0, { imageId: "noise" }, 1200, 1200)],
      files: { noise: { id: "noise", mimeType: "image/png", dataURL, created: 1 } },
      background: "#ffffff",
    });
    expect(png.length).toBeLessThanOrEqual(2 * 1024 * 1024);
    expect((await inspect(png)).width).toBeLessThanOrEqual(2048);
  }, 30_000);

  it("refuses corrupt raster files rather than returning an inaccurate placeholder", async () => {
    await expect(
      renderer.render({
        ...emptyScene(),
        elements: [element("bad", 0, 0, { imageId: "bad" })],
        files: {
          bad: {
            id: "bad",
            mimeType: "image/png",
            dataURL: "data:image/png;base64,iVBORw0KGgo=",
            created: 1,
          },
        },
        background: "#ffffff",
      }),
    ).rejects.toThrow();
    expect((await renderer.render(emptyScene())).length).toBeGreaterThan(33);
  }, 30_000);
});
