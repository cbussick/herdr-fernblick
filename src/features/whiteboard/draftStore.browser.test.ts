import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type ViteDevServer } from "vite";
import { chromium, webkit, type Browser, type Page } from "playwright";

let server: ViteDevServer;
let origin: string;
const browsers: Record<string, Browser> = {};
const native = { elements: [], files: {}, background: "#ffffff" };
const flow = { ...native, engine: "react-flow" };
const draft = (scene: unknown, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  boardId: "a".repeat(64),
  baseRevision: 127,
  baseScene: scene,
  scene,
  instruction: "Keep my prompt",
  dirty: true,
  paused: true,
  ...extra,
});
type Harness = {
  draftTest: {
    read(key: string): Promise<unknown>;
    write(key: string, value: unknown): Promise<void>;
    start(): Promise<{ engine?: string; revision?: number; conflict: boolean }>;
  };
};

declare global {
  interface Window {
    draftTest: Harness["draftTest"];
    heldDraftDb?: IDBDatabase;
  }
}

beforeAll(async () => {
  server = await createServer({
    configFile: false,
    server: { host: "127.0.0.1", port: 0 },
    plugins: [
      {
        name: "draft-cleanup-fixture",
        configureServer(server) {
          server.middlewares.use("/draft-cleanup", (_req, res) => {
            res.setHeader("Content-Type", "text/html");
            res.end(`<script type="module">
        import { draftStore } from '/src/features/whiteboard/draftStore.ts';
        import { BoardController } from '/src/features/whiteboard/BoardController.ts';
        window.draftTest = { ...draftStore, async start() {
          const scene = { engine:'react-flow', elements:[], files:{}, background:'#ffffff' };
          const api = {open:async()=>({id:'a'.repeat(64),revision:0,scene,updatedAt:Date.now(),lastAuthor:'human',snapshots:[],access:null}),events:()=>()=>{}};
          const owner = new BoardController('pane',{runtime:'11111111-1111-4111-8111-111111111111',epoch:'22222222-2222-4222-8222-222222222222',sessionId:'cleanup-session'},api,draftStore);
          try { await owner.start(); await owner.keepLocal(); const s=owner.getSnapshot(); return {engine:s.scene?.engine,revision:s.board?.revision,conflict:s.conflict}; } finally { owner.dispose(); }
        }};
      </script>`);
          });
        },
      },
    ],
  });
  await server.listen();
  const address = server.httpServer!.address();
  if (!address || typeof address === "string") throw new Error("No fixture listener");
  origin = `http://127.0.0.1:${address.port}`;
  browsers.chromium = await chromium.launch();
  browsers.webkit = await webkit.launch();
}, 60_000);
afterAll(async () => {
  await Promise.all(Object.values(browsers).map((b) => b.close()));
  await server?.close();
});
async function pageFor(browser: string) {
  const context = await browsers[browser]!.newContext();
  const page = await context.newPage();
  await page.goto(origin + "/draft-cleanup");
  await page.waitForFunction(() => !!(window as Harness).draftTest);
  return { context, page };
}
async function seed(page: Page, records: Record<string, unknown>, version = 1) {
  await page.evaluate(
    async ({ raw, version }) => {
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("fernblick-whiteboards", version);
        request.onupgradeneeded = () => request.result.createObjectStore("drafts");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result,
            tx = db.transaction("drafts", "readwrite");
          for (const [key, value] of Object.entries(JSON.parse(raw)))
            tx.objectStore("drafts").put(value, key);
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onabort = () => {
            db.close();
            reject(tx.error);
          };
        };
      });
    },
    { raw: JSON.stringify(records), version },
  );
}
async function rawRecords(page: Page) {
  return page.evaluate(
    async () =>
      new Promise<Record<string, unknown>>((resolve, reject) => {
        const request = indexedDB.open("fernblick-whiteboards");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result,
            tx = db.transaction("drafts", "readonly"),
            records: Record<string, unknown> = {};
          const cursor = tx.objectStore("drafts").openCursor();
          cursor.onsuccess = () => {
            if (cursor.result) {
              records[String(cursor.result.key)] = cursor.result.value;
              cursor.result.continue();
            }
          };
          tx.oncomplete = () => {
            db.close();
            resolve(records);
          };
        };
      }),
  );
}

describe.each(["chromium", "webkit"])("destructive Excalidraw cache cleanup (%s)", (browser) => {
  it("deletes all legacy drafts/recovery, preserving Flow drafts and unrelated browser storage", async () => {
    const { page, context } = await pageFor(browser);
    try {
      const valid = draft(flow, { recovery: flow, dirty: false, paused: false });
      const withLegacyRecovery = draft(flow, { recovery: native });
      await seed(page, {
        old: draft(native, { recovery: native }),
        explicit: draft({ ...native, engine: "excalidraw" }),
        flow: valid,
        recovery: withLegacyRecovery,
        nativeBase: draft(flow, { baseScene: native, paused: false, recovery: flow }),
        unknown: { unrelated: true },
      });
      await page.evaluate(() => localStorage.setItem("chat-draft", "Do not erase"));
      expect(await page.evaluate(() => (window as Harness).draftTest.read("old"))).toBeUndefined();
      const records = await rawRecords(page);
      expect(records.old).toBeUndefined();
      expect(records.explicit).toBeUndefined();
      expect(records.flow).toEqual(valid);
      const { recovery: _removed, ...expected } = withLegacyRecovery;
      expect(records.recovery).toEqual(expected);
      expect(records.nativeBase).toEqual(
        draft(flow, { baseScene: undefined, paused: true, recovery: flow }),
      );
      expect(records.unknown).toEqual({ unrelated: true });
      expect(await page.evaluate(() => localStorage.getItem("chat-draft"))).toBe("Do not erase");
    } finally {
      await context.close();
    }
  });
  it("opens the server's empty Flow revision zero instead of a cached native revision 127", async () => {
    const { page, context } = await pageFor(browser);
    try {
      await seed(page, {
        '["pane","cleanup-session"]': draft(native, { dirty: false, paused: false }),
      });
      expect(await page.evaluate(() => (window as Harness).draftTest.start())).toEqual({
        engine: "react-flow",
        revision: 0,
        conflict: false,
      });
    } finally {
      await context.close();
    }
  });
  it("handles a blocked upgrade without leaving an abandoned database connection open", async () => {
    const { page, context } = await pageFor(browser);
    try {
      await seed(page, { old: draft(native) });
      await page.evaluate(
        () =>
          new Promise<void>((resolve, reject) => {
            const request = indexedDB.open("fernblick-whiteboards", 1);
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
              window.heldDraftDb = request.result;
              resolve();
            };
          }),
      );
      const error = await page.evaluate(async () => {
        try {
          await window.draftTest.read("old");
          return "unexpected success";
        } catch (error) {
          return String(error);
        }
      });
      expect(error).toContain("Close other Fernblick tabs");
      await page.evaluate(() => {
        window.heldDraftDb!.close();
        delete window.heldDraftDb;
      });
      const next = await page.evaluate(
        () =>
          new Promise<string>((resolve, reject) => {
            const request = indexedDB.open("fernblick-whiteboards", 3);
            request.onblocked = () => resolve("blocked");
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
              request.result.close();
              resolve("upgraded");
            };
          }),
      );
      expect(next).toBe("upgraded");
      expect((await rawRecords(page)).old).toBeUndefined();
    } finally {
      await context.close();
    }
  });
  it("prevents old version-one clients and current writes from restoring native drafts", async () => {
    const { page, context } = await pageFor(browser);
    try {
      await seed(page, { old: draft(native) });
      await page.evaluate(() => (window as Harness).draftTest.read("old"));
      const oldVersion = await page.evaluate(
        () =>
          new Promise<string>((resolve) => {
            const request = indexedDB.open("fernblick-whiteboards", 1);
            request.onerror = () => resolve(request.error!.name);
            request.onsuccess = () => {
              request.result.close();
              resolve("opened");
            };
          }),
      );
      expect(oldVersion).toBe("VersionError");
      await page.evaluate(
        (raw) => (window as Harness).draftTest.write("old", JSON.parse(raw)),
        JSON.stringify(draft(native)),
      );
      await page.evaluate(
        (raw) => (window as Harness).draftTest.write("flow", JSON.parse(raw)),
        JSON.stringify(draft(flow, { recovery: native })),
      );
      await expect(
        page.evaluate(() => window.draftTest.write("flow", undefined)),
      ).rejects.toThrow();
      await seed(page, { injected: draft(native) }, 2);
      expect(
        await page.evaluate(() => (window as Harness).draftTest.read("injected")),
      ).toBeUndefined();
      const records = await rawRecords(page);
      expect(records.old).toBeUndefined();
      expect(records.injected).toBeUndefined();
      expect(records.flow).toEqual(draft(flow));
    } finally {
      await context.close();
    }
  });
});
