import { afterEach, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { QueueStore } from "./queueStore.js";
import { QueueDispatcher } from "./queueDispatcher.js";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));
function stores() {
  const dir = mkdtempSync(join(tmpdir(), "fernblick-queue-test-"));
  dirs.push(dir);
  const path = join(dir, "queue.sqlite");
  return [new QueueStore(path), new QueueStore(path)] as const;
}
const input = { text: "Hello", attachments: [] };
let nextRequestId = 1;
function create(store: QueueStore, pane: string, session: string, body: typeof input) {
  return store.create(pane, session, {
    ...body,
    requestId: String(nextRequestId++).padStart(32, "0"),
  })!;
}
const agent = (session: string, status: "working" | "idle", seq: number) => ({
  pane_id: "w1:p1",
  agent: "pi",
  agent_session: { value: session, kind: "path" as const, agent: "pi", source: "test" },
  agent_status: status,
  state_change_seq: seq,
  focused: false,
  revision: 1,
  tab_id: "w1:t1",
  workspace_id: "w1",
});

it("persists and scopes messages across two connections and enforces edit/delete races", () => {
  const [a, b] = stores();
  try {
    const message = create(a, "w1:p1", "session-a", input);
    expect(b.list("w1:p1", "session-a")).toHaveLength(1);
    expect(b.list("w1:p1", "session-b")).toEqual([]);
    expect(b.update("w1:p1", "session-b", message.id, { text: "wrong", attachments: [] })).toBe(
      false,
    );
    expect(b.update("w1:p1", "session-a", message.id, { text: "Updated", attachments: [] })).toBe(
      true,
    );
    expect(a.get("w1:p1", "session-a", message.id)?.text).toBe("Updated");
    expect(a.remove("w1:p1", "session-a", message.id)).toBe(true);
    expect(b.remove("w1:p1", "session-a", message.id)).toBe(false);
  } finally {
    a.close();
    b.close();
  }
});

it("claims each item at most once across servers, blocks later work, and never reclaims uncertain delivery", () => {
  const [a, b] = stores();
  try {
    const first = create(a, "w1:p1", "session-a", input);
    create(a, "w1:p1", "session-a", { text: "Later", attachments: [] });
    expect(a.claim("w1:p1", "session-a", 3)?.id).toBe(first.id);
    expect(b.claim("w1:p1", "session-a", 3)).toBeNull();
    expect(b.update("w1:p1", "session-a", first.id, input)).toBe(false);
    expect(b.remove("w1:p1", "session-a", first.id)).toBe(false);
    expect(b.transition(first.id, "sending", "uncertain")).toBe(true);
    expect(a.claim("w1:p1", "session-a", 4)).toBeNull();
    expect(b.retry("w1:p1", "session-a", first.id)).toBe(true);
    expect(a.claim("w1:p1", "session-a", 4)?.id).toBe(first.id);
    expect(a.transition(first.id, "sending", "submitted")).toBe(true);
    b.completeSubmitted("w1:p1", "session-a", 4);
    expect(b.claim("w1:p1", "session-a", 4)).toBeNull();
    b.completeSubmitted("w1:p1", "session-a", 5);
    expect(b.claim("w1:p1", "session-a", 5)?.text).toBe("Later");
  } finally {
    a.close();
    b.close();
  }
});

it("requeues safely if the agent starts working before dispatch", async () => {
  const [store, observer] = stores();
  try {
    const message = create(store, "w1:p1", "session-a", input);
    let status: "working" | "idle" = "idle";
    let calls = 0;
    let sent = 0;
    const dispatcher = new QueueDispatcher(store, {
      getDashboard: async () => ({
        agents: [agent("session-a", ++calls === 1 ? "idle" : status, calls)],
        tabs: [],
        workspaces: [],
      }),
      promptAgent: async () => {
        sent++;
        return agent("session-a", "working", 3);
      },
    });
    status = "working";
    await dispatcher.tick();
    expect(sent).toBe(0);
    expect(observer.get("w1:p1", "session-a", message.id)?.state).toBe("queued");
    status = "idle";
    await dispatcher.tick();
    expect(sent).toBe(1);
  } finally {
    store.close();
    observer.close();
  }
});

it("holds an unconfirmed send without retrying and fails missing temp images before dispatch", async () => {
  const [store, other] = stores();
  try {
    const sent: string[] = [];
    let status: "working" | "idle" = "idle";
    let seq = 1;
    const dispatcher = new QueueDispatcher(store, {
      getDashboard: async () => ({
        agents: [agent("session-a", status, seq)],
        tabs: [],
        workspaces: [],
      }),
      promptAgent: async (_target, text) => {
        sent.push(text);
        throw new Error("lost response");
      },
    });
    const missing = create(store, "w1:p1", "session-a", {
      text: "With image",
      attachments: ["00000000-0000-4000-8000-000000000000.png"],
    });
    await dispatcher.tick();
    expect(other.get("w1:p1", "session-a", missing.id)?.state).toBe("failed");
    expect(sent).toEqual([]);
    store.remove("w1:p1", "session-a", missing.id);
    const message = create(store, "w1:p1", "session-a", input);
    await dispatcher.tick();
    await dispatcher.tick();
    expect(sent).toEqual(["Hello"]);
    expect(other.get("w1:p1", "session-a", message.id)?.state).toBe("uncertain");
    status = "working";
    seq = 2;
    await dispatcher.tick();
    expect(sent).toHaveLength(1);
  } finally {
    store.close();
    other.close();
  }
});

it("two dispatchers sharing SQLite never send the same prompt concurrently", async () => {
  const [a, b] = stores();
  try {
    const message = create(a, "w1:p1", "session-a", input);
    let release!: () => void;
    const pause = new Promise<void>((resolve) => {
      release = resolve;
    });
    let sends = 0;
    const service = {
      getDashboard: async () => ({
        agents: [agent("session-a", "idle", 1)],
        tabs: [],
        workspaces: [],
      }),
      promptAgent: async () => {
        sends++;
        await pause;
        return agent("session-a", "working", 2);
      },
    };
    const first = new QueueDispatcher(a, service).tick();
    const second = new QueueDispatcher(b, service).tick();
    release();
    await Promise.all([first, second]);
    expect(sends).toBe(1);
    expect(a.get("w1:p1", "session-a", message.id)?.state).toBe("submitted");
  } finally {
    a.close();
    b.close();
  }
});

it("deduplicates retries across processes even after delivery", () => {
  const [a, b] = stores();
  try {
    const request = { ...input, requestId: "a".repeat(32) };
    const first = a.create("w1:p1", "session-a", request)!;
    expect(b.create("w1:p1", "session-a", request)?.id).toBe(first.id);
    expect(b.create("w1:p1", "session-a", { ...request, text: "different" })).toBeNull();
    expect(a.claim("w1:p1", "session-a", 1)?.id).toBe(first.id);
    a.transition(first.id, "sending", "submitted");
    b.completeSubmitted("w1:p1", "session-a", 2);
    expect(a.list("w1:p1", "session-a")).toEqual([]);
    expect(b.create("w1:p1", "session-a", request)?.state).toBe("delivered");
  } finally {
    a.close();
    b.close();
  }
});

it("dispatches a queued prompt after a server restart", async () => {
  const [oldStore, observer] = stores();
  try {
    const message = create(oldStore, "w1:p1", "session-a", input);
    oldStore.close();
    const sent: string[] = [];
    const dispatcher = new QueueDispatcher(observer, {
      getDashboard: async () => ({
        agents: [agent("session-a", "idle", 7)],
        tabs: [],
        workspaces: [],
      }),
      promptAgent: async (_target, text) => {
        sent.push(text);
        return agent("session-a", "working", 8);
      },
    });
    await dispatcher.tick();
    expect(sent).toEqual(["Hello"]);
    expect(observer.get("w1:p1", "session-a", message.id)?.state).toBe("submitted");
  } finally {
    observer.close();
  }
});

it("moves abandoned claims to uncertain without redelivering", () => {
  const [a, b] = stores();
  try {
    const message = create(a, "w1:p1", "session-a", input);
    const claimed = a.claim("w1:p1", "session-a", 1)!;
    b.expireLostClaims(claimed.claimedAt! + 120_001);
    expect(b.get("w1:p1", "session-a", message.id)?.state).toBe("uncertain");
    expect(a.claim("w1:p1", "session-a", 2)).toBeNull();
  } finally {
    a.close();
    b.close();
  }
});

it("rechecks session identity immediately before prompting", async () => {
  const [store, other] = stores();
  try {
    const message = create(store, "w1:p1", "old-session", input);
    let reads = 0;
    let sent = false;
    const dispatcher = new QueueDispatcher(store, {
      getDashboard: async () => ({
        agents: [agent(++reads === 1 ? "old-session" : "replacement", "idle", reads)],
        tabs: [],
        workspaces: [],
      }),
      promptAgent: async () => {
        sent = true;
        return agent("replacement", "working", 3);
      },
    });
    await dispatcher.tick();
    expect(sent).toBe(false);
    expect(other.get("w1:p1", "old-session", message.id)?.state).toBe("failed");
  } finally {
    store.close();
    other.close();
  }
});

it("will not dispatch to a replacement session on the same pane", async () => {
  const [store, other] = stores();
  try {
    create(store, "w1:p1", "old-session", input);
    let called = false;
    const dispatcher = new QueueDispatcher(store, {
      getDashboard: async () => ({
        agents: [agent("new-session", "idle", 3)],
        tabs: [],
        workspaces: [],
      }),
      promptAgent: async () => {
        called = true;
        return agent("new-session", "working", 4);
      },
    });
    await dispatcher.tick();
    expect(called).toBe(false);
    expect(other.list("w1:p1", "old-session")).toHaveLength(1);
  } finally {
    store.close();
    other.close();
  }
});
