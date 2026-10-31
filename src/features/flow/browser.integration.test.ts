import { createServer, type Server } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { build } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { defaults, makeNode } from "./model";
import { makeInk } from "./ink";
import { exportFlowScene, fromDiagram } from "./scene";
import type { BoardScene } from "../../../packages/pi-live-chat/boardProtocol";
import type {} from "../../flow-board-render";
import type {} from "./editor.fixture";
let directory: string, server: Server, browser: Browser, page: Page, origin: string;
const empty: BoardScene = { engine: "react-flow", elements: [], files: {}, background: "#ffffff" };
const requests: string[] = [];
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "flow-ui-"));
  await build({
    configFile: false,
    logLevel: "silent",
    build: {
      outDir: directory,
      rolldownOptions: { input: ["flow-board-render.html", "src/features/flow/editor.test.html"] },
    },
  });
  server = createServer(async (req, res) => {
    try {
      const path = new URL(req.url!, "http://localhost").pathname;
      requests.push(path);
      const data = await readFile(join(directory, path));
      res.setHeader(
        "Content-Type",
        (
          {
            ".html": "text/html",
            ".js": "text/javascript",
            ".css": "text/css",
            ".woff2": "font/woff2",
          } as Record<string, string>
        )[extname(path)] ?? "application/octet-stream",
      );
      res.end(data);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No address");
  origin = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
}, 60000);
afterAll(async () => {
  await browser?.close();
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  if (directory) await rm(directory, { recursive: true, force: true });
});
const loadEditor = async () => {
  await page.goto(`${origin}/src/features/flow/editor.test.html`);
  await page.waitForFunction(() => window.flowTest?.ready);
};
async function draw() {
  const box = await page.getByTestId("canvas").boundingBox();
  if (!box) throw new Error("Canvas missing");
  await page.mouse.move(box.x + 400, box.y + 220);
  await page.mouse.down();
  await page.mouse.move(box.x + 500, box.y + 270, { steps: 8 });
  await page.mouse.up();
}
describe("isolated production editor and DOM renderer", { timeout: 30_000 }, () => {
  it("edits/cancels components, reports change before idle, clears undo on external generation and honors lock", async () => {
    await loadEditor();
    await page.getByRole("button", { name: "Add Card", exact: true }).click();
    await page.getByLabel("Title", { exact: true }).fill("Cancelled");
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    expect(await page.evaluate(() => window.flowTest.changes.length)).toBe(0);
    await page.getByRole("button", { name: "Add Card", exact: true }).click();
    await page.getByLabel("Title", { exact: true }).fill("Production card");
    await page.getByRole("button", { name: "Add component", exact: true }).click();
    await page.waitForFunction(() => window.flowTest.changes.length === 1);
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    expect(await page.evaluate(() => window.flowTest.events.at(-1))).toBe("idle");
    expect(await page.locator('dialog[data-ui="flow-component-editor"][open]').count()).toBe(0);
    await page.getByRole("button", { name: "Draw", exact: true }).click();
    await draw();
    await page.waitForFunction(() =>
      window.flowTest.changes.at(-1)?.elements.some((e) => e.type === "ink"),
    );
    const events = await page.evaluate(() => window.flowTest.events);
    expect(events.lastIndexOf("change")).toBeLessThan(events.lastIndexOf("idle"));
    await page.getByRole("button", { name: "Undo drawing", exact: true }).click();
    await page.waitForFunction(() =>
      window.flowTest.changes.at(-1)?.elements.some((e) => e.type === "ink" && e.isDeleted),
    );
    await page.getByRole("button", { name: "Redo drawing", exact: true }).click();
    const count = await page.evaluate(() => window.flowTest.changes.length);
    await page.evaluate((raw) => window.flowTest.setScene(JSON.parse(raw)), JSON.stringify(empty));
    await page.waitForTimeout(150);
    expect(await page.evaluate(() => window.flowTest.changes.length)).toBe(count);
    expect(await page.getByRole("button", { name: "Undo drawing", exact: true }).isDisabled()).toBe(
      true,
    );
    await page.evaluate(() => window.flowTest.setLocked(true));
    expect(await page.getByRole("button", { name: "Add Card", exact: true }).isDisabled()).toBe(
      true,
    );
    expect(await page.getByRole("button", { name: "Draw", exact: true }).isDisabled()).toBe(true);
    expect(await page.evaluate(() => window.flowTest.errors)).toEqual([]);
  });
  it("requires confirmation for import, preserves tombstones and does not dirty-loop external changes", async () => {
    await loadEditor();
    const first = fromDiagram(
      { nodes: [makeNode("card", 0, 0, defaults("card"), "original")], edges: [] },
      empty,
    );
    await page.evaluate((raw) => window.flowTest.setScene(JSON.parse(raw)), JSON.stringify(first));
    await page.waitForTimeout(100);
    const backup = exportFlowScene(
      fromDiagram(
        { nodes: [makeNode("comment", 0, 0, defaults("comment"), "imported")], edges: [] },
        empty,
      ),
    );
    const upload = () =>
      page.getByLabel("Import flow JSON").setInputFiles({
        name: "backup.flow.json",
        mimeType: "application/json",
        buffer: Buffer.from(backup),
      });
    await upload();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    expect(await page.evaluate(() => window.flowTest.changes.length)).toBe(0);
    await upload();
    await page.getByRole("button", { name: "Replace drawing", exact: true }).click();
    await page.waitForFunction(() => window.flowTest.changes.length === 1);
    const result = await page.evaluate(() => JSON.stringify(window.flowTest.changes[0]));
    const parsed = JSON.parse(result) as BoardScene;
    expect(parsed.elements.find((e) => e.id === "original")!.isDeleted).toBe(true);
    expect(parsed.elements.filter((e) => !e.isDeleted)).toHaveLength(1);
    expect(parsed.elements.filter((e) => !e.isDeleted)[0]!.id).not.toBe("imported");
    expect(await page.evaluate(() => window.flowTest.errors)).toEqual([]);
  });
  it("retains pen priority over an existing palm and suppresses native iPad Scribble touchstart", async () => {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      hasTouch: true,
      userAgent: "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
    });
    const penPage = await context.newPage();
    await penPage.goto(`${origin}/src/features/flow/editor.test.html`);
    await penPage.waitForFunction(() => window.flowTest?.ready);
    await penPage.getByRole("button", { name: "Draw", exact: true }).click();
    const suppressed = await penPage
      .getByTestId("ink-surface")
      .evaluate(
        (el) =>
          !el.dispatchEvent(new TouchEvent("touchstart", { bubbles: true, cancelable: true })),
      );
    expect(suppressed).toBe(true);
    const session = await context.newCDPSession(penPage);
    await session.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: 900, y: 600, id: 1 }],
    });
    for (let i = 0; i < 3; i++) {
      await session.send("Input.dispatchMouseEvent", {
        type: "mousePressed",
        x: 600 + i * 50,
        y: 400,
        button: "left",
        buttons: 1,
        pointerType: "pen",
        force: 0.4,
      });
      await session.send("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: 630 + i * 50,
        y: 450,
        button: "left",
        buttons: 1,
        pointerType: "pen",
        force: 0.8,
      });
      await session.send("Input.dispatchMouseEvent", {
        type: "mouseReleased",
        x: 640 + i * 50,
        y: 420,
        button: "left",
        buttons: 0,
        pointerType: "pen",
        force: 0,
      });
    }
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await penPage.waitForFunction(
      () =>
        window.flowTest.changes.at(-1)?.elements.filter((e) => e.type === "ink" && !e.isDeleted)
          .length === 3,
    );
    expect(await penPage.evaluate(() => window.flowTest.errors)).toEqual([]);
    await context.close();
  });
  it("captures real local-font DOM with tables, raster images, ink, connections and auto-height content", async () => {
    await page.goto(`${origin}/flow-board-render.html`);
    await page.waitForFunction(() => !!window.prepareFlowBoardScene);
    const table = makeNode("table", -200, -100, defaults("table"), "table");
    table.data.rows = Array.from({ length: 35 }, (_, i) => [`Row ${i}`, "Local table"]);
    const card = makeNode("card", 300, 0, defaults("card"), "card");
    card.data.title = "Local image";
    card.data.image =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9l8AAAAASUVORK5CYII=";
    const scene = fromDiagram(
      {
        nodes: [
          table,
          card,
          makeInk(
            "ink",
            [
              [100, 500, 0.4],
              [400, 600, 0.9],
            ],
            "#243044",
            10,
            true,
          ),
        ],
        edges: [
          {
            id: "edge",
            source: "table",
            target: "card",
            label: "Connection",
            sourceHandle: "right",
            targetHandle: "left",
          },
        ],
      },
      empty,
    );
    const size = await page.evaluate(
      (raw) => window.prepareFlowBoardScene(JSON.parse(raw)),
      JSON.stringify(scene),
    );
    expect(size.width).toBeGreaterThan(100);
    expect(size.height).toBeGreaterThan(900);
    expect(size.width * size.height).toBeLessThanOrEqual(2097152);
    await page.setViewportSize(size);
    const png = await page.screenshot();
    expect(png.subarray(1, 4).toString()).toBe("PNG");
    expect(png.length).toBeGreaterThan(10000);
    expect(await page.getByText("Row 34", { exact: true }).isVisible()).toBe(true);
    const smaller = await page.evaluate(
      (raw) => window.prepareFlowBoardScene(JSON.parse(raw), 0.5),
      JSON.stringify(scene),
    );
    expect(smaller.width).toBe(Math.floor(size.width / 2));
    expect(smaller.height).toBe(Math.floor(size.height / 2));
    const emptySize = await page.evaluate(
      (raw) => window.prepareFlowBoardScene(JSON.parse(raw)),
      JSON.stringify(empty),
    );
    expect(emptySize).toEqual({ width: 320, height: 256 });
    expect(requests.filter((path) => path.startsWith("/api/"))).toEqual([]);
    expect(requests.some((path) => path.endsWith(".woff2"))).toBe(true);
  });
  it("fails explicitly on corrupt images and broken local fonts", async () => {
    await page.goto(`${origin}/flow-board-render.html`);
    await page.waitForFunction(() => !!window.prepareFlowBoardScene);
    const n = makeNode("card", 0, 0);
    n.data.image = "data:image/png;base64,iVBORw0KGgo=";
    const scene = fromDiagram({ nodes: [n], edges: [] }, empty);
    await expect(
      page.evaluate((raw) => window.prepareFlowBoardScene(JSON.parse(raw)), JSON.stringify(scene)),
    ).rejects.toThrow(/image/i);
    const context = await browser.newContext();
    const fontPage = await context.newPage();
    await fontPage.route(/\.(?:woff2?|ttf)$/, (route) => route.abort());
    await fontPage.goto(`${origin}/flow-board-render.html`);
    await fontPage.waitForFunction(() => !!window.prepareFlowBoardScene);
    await expect(
      fontPage.evaluate(
        (raw) => window.prepareFlowBoardScene(JSON.parse(raw)),
        JSON.stringify(empty),
      ),
    ).rejects.toThrow();
    await context.close();
  });
});
