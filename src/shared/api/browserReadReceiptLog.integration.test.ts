import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { createServer } from "vite";
import { expect, it } from "vitest";

it("retains a browser-only failure across closing and reopening a browser profile", async () => {
  const profile = await mkdtemp(join(tmpdir(), "fernblick-log-browser-"));
  const vite = await createServer({
    configFile: false,
    logLevel: "silent",
    optimizeDeps: { noDiscovery: true, exclude: ["zod"] },
    server: { host: "127.0.0.1", port: 0 },
    plugins: [
      {
        name: "empty-log-fixture",
        configureServer(server) {
          server.middlewares.use((request, response, next) => {
            if (request.url !== "/log-fixture") return next();
            response.setHeader("Content-Type", "text/html");
            response.end("<!doctype html><title>Isolated log fixture</title>");
          });
        },
      },
    ],
  });
  let browser: Awaited<ReturnType<typeof chromium.launchPersistentContext>> | undefined;
  try {
    await vite.listen();
    const address = vite.httpServer!.address() as { port: number };
    const url = `http://127.0.0.1:${address.port}/log-fixture`;
    browser = await chromium.launchPersistentContext(profile, { headless: true });
    let page = await browser.newPage();
    await page.goto(url);
    const id = "12345678-1234-4234-8234-123456789abc";
    // Use browser source text so Vitest doesn't rewrite this import for its SSR runtime.
    await page.evaluate(`import("/src/shared/api/browserReadReceiptLog.ts").then(module => {
      module.createBrowserReadReceiptDiagnostics()({ boundary: "client", operation: "save", category: "network", requestId: "${id}", durationMs: 15 });
    })`);
    await browser.close();
    browser = await chromium.launchPersistentContext(profile, { headless: true });
    page = await browser.newPage();
    await page.goto(url);
    const records = await page.evaluate(
      'import("/src/shared/api/browserReadReceiptLog.ts").then(module => module.getReadReceiptHistory().records)',
    );
    expect(records).toEqual([
      expect.objectContaining({ requestId: id, category: "network", boundary: "client" }),
    ]);
  } finally {
    await browser?.close();
    await vite.close();
    await rm(profile, { recursive: true, force: true });
  }
}, 60_000);
