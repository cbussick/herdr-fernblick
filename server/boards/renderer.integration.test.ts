import { createServer, type Server } from "node:http";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { build } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { BoardElement, BoardScene } from "../../packages/pi-live-chat/boardProtocol.js";
import { localExcalidrawFonts } from "../../tools/local-excalidraw-fonts.js";
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
    plugins: [localExcalidrawFonts()],
    build: { outDir: directory, rolldownOptions: { input: "whiteboard-render.html" } },
  });
  await cp(
    "node_modules/@excalidraw/excalidraw/dist/prod/fonts",
    join(directory, "excalidraw/fonts"),
    { recursive: true },
  );
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
    if (path === "/whiteboard-render.html" && redirectEntry) {
      response.writeHead(302, { Location: redirectEntry }).end();
      return;
    }
    if (path === "/whiteboard-render.html" && hostileScript) {
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

function element(
  type: BoardElement["type"],
  id: string,
  x: number,
  y: number,
  props: Record<string, unknown> = {},
): BoardElement {
  return {
    id,
    type,
    x,
    y,
    width: 100,
    height: 80,
    angle: 0,
    strokeColor: "#111111",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 2,
    strokeStyle: "solid",
    roughness: 0,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: null,
    seed: 1,
    version: 1,
    versionNonce: 1,
    isDeleted: false,
    boundElements: null,
    updated: 1,
    link: null,
    locked: false,
    index: null,
    ...props,
  } as BoardElement;
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
    canvas.width = noise ? 1200 : 20;
    canvas.height = noise ? 1200 : 20;
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

describe("native browser board rendering", () => {
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
      const baseline = await renderer.render(emptyScene());
      redirectAsset = `${external}/redirected-script.js`;
      // Substitute an adversarial same-origin module to test the network policy
      // independently of the production CSP and validated-scene restrictions.
      hostileScript = `
        window.renderBoardScene = async () => {
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
          return ${JSON.stringify(baseline.toString("base64"))};
        };
      `;
      requests.length = 0;
      expect(await renderer.render(emptyScene())).toEqual(baseline);
      expect(requests).toEqual(
        expect.arrayContaining([
          "/whiteboard-render.html",
          "/assets/probe.js",
          "/assets/redirect.js",
        ]),
      );
      expect(
        requests.every(
          (path) => path === "/whiteboard-render.html" || /^\/assets\/[\w.-]+\.js$/.test(path),
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
  it("renders full native geometry, text/local fonts, pressure freehand and raster assets with no editor open", async () => {
    const dataURL = await raster();
    const scene: BoardScene = {
      elements: [
        element("rectangle", "rectangle", 0, 0, { backgroundColor: "#ff0000", angle: 0.2 }),
        element("ellipse", "ellipse", 150, 0),
        element("diamond", "diamond", 300, 0),
        element("arrow", "arrow", 0, 130, {
          points: [
            [0, 0],
            [60, 35],
            [100, 0],
          ],
          startArrowhead: null,
          endArrowhead: "arrow",
          startBinding: null,
          endBinding: null,
        }),
        element("line", "line", 150, 130, {
          points: [
            [0, 0],
            [100, 80],
          ],
          startArrowhead: null,
          endArrowhead: null,
        }),
        element("freedraw", "pen", 300, 130, {
          strokeColor: "#00cc00",
          strokeWidth: 12,
          points: [
            [0, 0],
            [20, 40],
            [40, 10],
            [60, 60],
            [100, 30],
          ],
          pressures: [0.3, 0.6, 1, 0.6, 0.3],
          simulatePressure: false,
        }),
        element("image", "image", 450, 0, {
          fileId: "raster",
          status: "saved",
          scale: [1, 1],
          crop: null,
        }),
        element("frame", "frame", 600, 0, { width: 140, height: 240, name: "Native frame" }),
        element("rectangle", "framed", 620, 20, { frameId: "frame", width: 80, height: 80 }),
        ...[1, 2, 3, 5, 6, 7, 8, 9].map((fontFamily, index) =>
          element("text", `text${index}`, 0, 260 + index * 40, {
            width: 400,
            height: 30,
            text: fontFamily === 5 ? "Native fonts ABC 123 中文" : "Native fonts ABC 123",
            originalText: fontFamily === 5 ? "Native fonts ABC 123 中文" : "Native fonts ABC 123",
            fontSize: 24,
            fontFamily,
            textAlign: "left",
            verticalAlign: "top",
            containerId: null,
            autoResize: true,
            lineHeight: 1.25,
          }),
        ),
        element("rectangle", "deleted", 900000, 900000, { isDeleted: true }),
      ],
      files: { raster: { id: "raster", mimeType: "image/png", dataURL, created: 1 } },
      background: "#ffffff",
    };
    requests.length = 0;
    fontPaths.length = 0;
    const png = await renderer.render(scene);
    const result = await inspect(png);
    expect(result.width).toBeGreaterThan(700);
    expect(result.width).toBeLessThan(900); // Deleted element must not expand bounds.
    expect(result.height).toBeGreaterThan(450);
    expect(result.red).toBeGreaterThan(5000);
    expect(result.blue).toBeGreaterThan(5000);
    expect(result.green).toBeGreaterThan(200);
    expect(result.dark).toBeGreaterThan(4000);
    for (const family of [
      "Virgil",
      "Cascadia",
      "Excalifont",
      "Nunito",
      "Lilita",
      "ComicShanns",
      "Liberation",
      "Xiaolai",
    ])
      expect(fontPaths.some((path) => path.includes(`/${family}/`))).toBe(true);
    expect(
      requests.every(
        (path) =>
          path === "/whiteboard-render.html" ||
          path.startsWith("/assets/") ||
          path.startsWith("/excalidraw/fonts/"),
      ),
    ).toBe(true);
  }, 30_000);

  it("fails explicitly if local text fonts are missing", async () => {
    denyFonts = true;
    try {
      await expect(
        renderer.render({
          ...emptyScene(),
          elements: [
            element("text", "missingfont", 0, 0, {
              text: "Missing local font",
              originalText: "Missing local font",
              fontSize: 24,
              fontFamily: 5,
              lineHeight: 1.25,
              textAlign: "left",
              verticalAlign: "top",
              containerId: null,
              autoResize: true,
            }),
          ],
        }),
      ).rejects.toThrow(/fonts/);
    } finally {
      denyFonts = false;
    }
  }, 30_000);

  it("shuts down an in-flight real browser without waiting for its pending export", async () => {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No test address");
    const closingRenderer = new BoardRenderer(`http://127.0.0.1:${address.port}`);
    hostileScript = "window.renderBoardScene = () => new Promise(() => {});";
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

  it("fits huge and extreme-aspect scenes within the pixel and side limits", async () => {
    const png = await renderer.render({
      ...emptyScene(),
      elements: [
        element("rectangle", "huge", -1000000, -1000000, { width: 100000, height: 100000 }),
        element("ellipse", "distant", 1000000, 1000000),
      ],
    });
    const dimensions = await inspect(png);
    expect(Math.max(dimensions.width, dimensions.height)).toBeLessThanOrEqual(2048);
    expect(dimensions.width * dimensions.height).toBeLessThanOrEqual(2 * 1024 * 1024);
    const thin = await inspect(
      await renderer.render({
        ...emptyScene(),
        elements: [
          element("line", "thin", 0, 0, {
            width: 100000,
            height: 0,
            points: [
              [0, 0],
              [100000, 0],
            ],
          }),
        ],
      }),
    );
    expect(thin.width).toBe(2048);
    expect(thin.height).toBeGreaterThan(0);
  }, 30_000);

  it("downscales high-entropy raster output to the socket-safe PNG byte limit", async () => {
    const dataURL = await raster(true);
    const png = await renderer.render({
      elements: [
        element("image", "noise", 0, 0, {
          width: 1200,
          height: 1200,
          fileId: "noise",
          status: "saved",
          scale: [1, 1],
          crop: null,
        }),
      ],
      files: { noise: { id: "noise", mimeType: "image/png", dataURL, created: 1 } },
      background: "#ffffff",
    });
    expect(png.length).toBeLessThanOrEqual(2 * 1024 * 1024);
    expect((await inspect(png)).width).toBeLessThan(1024);
  }, 30_000);

  it("refuses corrupt raster files rather than returning an inaccurate placeholder", async () => {
    await expect(
      renderer.render({
        elements: [
          element("image", "bad", 0, 0, { fileId: "bad", status: "saved", scale: [1, 1] }),
        ],
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
