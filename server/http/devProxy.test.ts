import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer as createViteServer } from "vite";
import type { ViteDevServer } from "vite";
import { expect, test, vi } from "vitest";
import config from "../../vite.config.js";
import { createHttpServer } from "./server.js";
import { HerdrService } from "../herdr/herdrService.js";
import { LiveBridge } from "../pi/liveBridge.js";
import { agentSchema } from "../../src/shared/api/contracts.js";
import { ackSchema } from "../../packages/pi-live-chat/protocol.js";

test("the configured dev proxy accepts browser-origin prompts without weakening the origin guard", async () => {
  const directory = await mkdtemp(join(tmpdir(), "fernblick-proxy-"));
  const requestId = randomUUID();
  const ack = ackSchema.parse({ type: "ack", id: requestId, outcome: "invoked" });
  const service = new HerdrService({
    request: async () => {
      throw new Error("Unexpected Herdr request");
    },
  });
  const getAgent = vi.spyOn(service, "getAgent").mockResolvedValue(
    agentSchema.parse({
      pane_id: "fixture",
      name: "fixture",
      agent_status: "idle",
      focused: false,
      revision: 0,
      tab_id: "t1",
      workspace_id: "w1",
    }),
  );
  const bridge = new LiveBridge(join(directory, "pi.sock"), join(directory, "herdr.sock"));
  const forward = vi.spyOn(bridge, "request").mockResolvedValue(ack);
  // Real HTTP handler and Vite proxy, but no Herdr/Pi connections or agent commands.
  const backend = createHttpServer(service, directory, bridge);
  let frontend: ViteDevServer | undefined;
  try {
    await new Promise<void>((resolve) => {
      backend.listen(0, "127.0.0.1", resolve);
    });
    const backendAddress = backend.address();
    if (!backendAddress || typeof backendAddress === "string") {
      throw new Error("Expected backend TCP address");
    }
    const target = `http://127.0.0.1:${backendAddress.port}`;
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
    const frontendAddress = frontend.httpServer?.address();
    if (!frontendAddress || typeof frontendAddress === "string") {
      throw new Error("Expected frontend TCP address");
    }
    const base = `http://127.0.0.1:${frontendAddress.port}`;
    const body = JSON.stringify({
      text: "Synthetic annotation feedback",
      target: { runtime: randomUUID(), epoch: randomUUID(), sessionId: "fixture" },
      requestId,
    });
    for (const origin of [base, "https://untrusted.invalid", undefined]) {
      getAgent.mockClear();
      forward.mockClear();
      const headers = new Headers({ "Content-Type": "application/json" });
      if (origin) {
        headers.set("Origin", origin);
      }
      const response = await fetch(`${base}/api/agents/fixture/prompt`, {
        method: "POST",
        headers,
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
    if (backend.listening) {
      await new Promise<void>((resolve) => {
        backend.close(() => resolve());
      });
    }
    await rm(directory, { recursive: true, force: true });
  }
});
