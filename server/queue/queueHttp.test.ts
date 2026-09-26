import { it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import type { HerdrService } from "../herdr/herdrService.js";
import { createHttpServer } from "../http/server.js";
import { QueueStore } from "./queueStore.js";

it("persists a queue via HTTP across server restarts and enforces state transitions", async () => {
  const dir = mkdtempSync(join(tmpdir(), "fernblick-http-test-"));
  const path = join(dir, "queue.sqlite");
  const agent = {
    pane_id: "w1:p1",
    name: "test",
    agent: "pi",
    agent_status: "working",
    agent_session: { value: "session-a", kind: "path" },
  };
  const service = {
    getDashboard: async () => ({ agents: [agent], tabs: [], workspaces: [] }),
  } as unknown as HerdrService;
  let store = new QueueStore(path);
  let server = createHttpServer(service, dir, store);
  try {
    for (let run = 0; run < 2; run++) {
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const url = `${base}/api/agents/test/queue`;
      const headers = { Origin: base, "Content-Type": "application/json" };
      const input = { requestId: "a".repeat(32), text: "Persist me", attachments: [] };
      if (run === 0) {
        const response = await fetch(url, { method: "POST", headers, body: JSON.stringify(input) });
        expect(response.status).toBe(201);
        expect((await response.json()).message.text).toBe("Persist me");
      } else {
        const messages = (await (await fetch(url)).json()).messages;
        expect(messages).toHaveLength(1);
        expect(
          (await fetch(url, { method: "POST", headers, body: JSON.stringify(input) })).status,
        ).toBe(201);
        expect((await (await fetch(url)).json()).messages).toHaveLength(1);
        const id = messages[0].id;
        expect(
          (
            await fetch(`${url}/${id}`, {
              method: "PATCH",
              headers,
              body: JSON.stringify({ text: "Updated", attachments: [] }),
            })
          ).status,
        ).toBe(200);
        expect((await fetch(`${url}/${id}`, { method: "DELETE", headers })).status).toBe(200);
        expect((await (await fetch(url)).json()).messages).toEqual([]);
      }
      await new Promise<void>((resolve) => server.close(() => resolve()));
      store.close();
      if (run === 0) {
        store = new QueueStore(path);
        server = createHttpServer(service, dir, store);
      }
    }
  } finally {
    if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
    if (store)
      try {
        store.close();
      } catch {
        /* already closed */
      }
    rmSync(dir, { recursive: true, force: true });
  }
});
