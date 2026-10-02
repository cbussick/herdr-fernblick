import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer as createViteServer, type ViteDevServer } from "vite";
import { expect, test, vi } from "vitest";
import config from "../../vite.config.js";
import { createHttpServer } from "./server.js";
import type { HerdrService } from "../herdr/herdrService.js";
import type { LiveBridge } from "../pi/liveBridge.js";

test("the configured dev proxy accepts browser-origin prompts without weakening the origin guard", async () => {
  const directory = await mkdtemp(join(tmpdir(), "fernblick-proxy-"));
  const requestId = randomUUID();
  const ack = { type: "ack", id: requestId, outcome: "invoked" };
  const getAgent = vi.fn(async () => ({ name: "fixture" }));
  const forward = vi.fn(async () => ack);
  // Real HTTP handler and Vite proxy, but no Herdr/Pi connections or agent commands.
  const backend = createHttpServer({ getAgent } as unknown as HerdrService, directory, {
    request: forward,
  } as unknown as LiveBridge);
  let frontend: ViteDevServer | undefined;
  try {
    await new Promise<void>((resolve) => backend.listen(0, "127.0.0.1", resolve));
    const target = `http://127.0.0.1:${(backend.address() as AddressInfo).port}`;
    const options = config.server?.proxy?.["/api"];
    expect(options).toBeDefined();
    frontend = await createViteServer({
      configFile: false,
      root: directory,
      cacheDir: join(directory, ".cache"),
      appType: "custom",
      logLevel: "silent",
      optimizeDeps: { noDiscovery: true, include: [] },
      server: {
        host: "127.0.0.1",
        port: 0,
        hmr: false,
        // Preserve the real config's string-vs-object behavior. Switching back
        // to string shorthand must reproduce the rejected valid-origin send.
        proxy: { "/api": typeof options === "string" ? target : { ...options, target } },
      },
    });
    await frontend.listen();
    const base = `http://127.0.0.1:${(frontend.httpServer!.address() as AddressInfo).port}`;
    const body = JSON.stringify({
      text: "Synthetic annotation feedback",
      target: { runtime: randomUUID(), epoch: randomUUID(), sessionId: "fixture" },
      requestId,
    });
    for (const origin of [base, "https://untrusted.invalid", undefined]) {
      getAgent.mockClear();
      forward.mockClear();
      const response = await fetch(`${base}/api/agents/fixture/prompt`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(origin ? { Origin: origin } : {}) },
        body,
      });
      if (origin === base) {
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual(ack);
        expect(getAgent).toHaveBeenCalledOnce();
        expect(forward).toHaveBeenCalledOnce();
      } else {
        expect(response.status).toBe(403);
        expect(getAgent).not.toHaveBeenCalled();
        expect(forward).not.toHaveBeenCalled();
      }
    }
  } finally {
    await frontend?.close();
    backend.closeAllConnections();
    if (backend.listening) await new Promise<void>((resolve) => backend.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});
