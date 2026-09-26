import { chmodSync, mkdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type { QueuedMessageCreate, QueuedMessageInput } from "../../src/shared/api/contracts.js";

export type QueueState = "queued" | "sending" | "submitted" | "uncertain" | "failed" | "delivered";
export type QueueItem = {
  id: string;
  paneId: string;
  session: string;
  text: string;
  attachments: string[];
  state: QueueState;
  error: string | null;
  createdAt: number;
  statusSequence: number;
  claimedAt: number | null;
};

type Row = Omit<
  QueueItem,
  "paneId" | "createdAt" | "statusSequence" | "claimedAt" | "attachments"
> & {
  pane_id: string;
  created_at: number;
  status_sequence: number;
  claimed_at: number | null;
  attachments: string;
};

const columns =
  "id, pane_id, session, text, attachments, state, error, created_at, status_sequence, claimed_at";
function decode(row: Row): QueueItem {
  return {
    id: row.id,
    paneId: row.pane_id,
    session: row.session,
    text: row.text,
    attachments: JSON.parse(row.attachments) as string[],
    state: row.state,
    error: row.error,
    createdAt: row.created_at,
    statusSequence: row.status_sequence,
    claimedAt: row.claimed_at,
  };
}

export class QueueStore {
  private readonly db: DatabaseSync;
  constructor(
    path = process.env.FERNBLICK_DB_PATH ?? join(homedir(), ".local/share/fernblick/queue.sqlite"),
  ) {
    if (path !== ":memory:") {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      if (statSync(dirname(path)).mode & 0o077) {
        throw new Error("Queue database directory must be private (mode 0700)");
      }
    }
    this.db = new DatabaseSync(path, { timeout: 3000 });
    if (path !== ":memory:") chmodSync(path, 0o600);
    this.db.exec(`
      PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS queued_messages (
        id TEXT PRIMARY KEY, request_id TEXT NOT NULL UNIQUE, pane_id TEXT NOT NULL, session TEXT NOT NULL,
        text TEXT NOT NULL, attachments TEXT NOT NULL,
        state TEXT NOT NULL CHECK(state IN ('queued','sending','submitted','uncertain','failed','delivered')),
        error TEXT, created_at INTEGER NOT NULL, status_sequence INTEGER NOT NULL DEFAULT 0,
        claimed_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS queued_messages_scope ON queued_messages(pane_id, session, created_at, id);
    `);
  }

  close() {
    this.db.close();
  }

  list(paneId: string, session: string): QueueItem[] {
    return (
      this.db
        .prepare(
          `SELECT ${columns} FROM queued_messages WHERE pane_id=? AND session=? AND state != 'delivered' ORDER BY created_at, rowid`,
        )
        .all(paneId, session) as Row[]
    ).map(decode);
  }

  create(paneId: string, session: string, input: QueuedMessageCreate): QueueItem | null {
    const id = randomUUID();
    this.db
      .prepare(
        "INSERT INTO queued_messages(id,request_id,pane_id,session,text,attachments,state,created_at) VALUES(?,?,?,?,?,?,'queued',?) ON CONFLICT(request_id) DO NOTHING",
      )
      .run(
        id,
        input.requestId,
        paneId,
        session,
        input.text,
        JSON.stringify(input.attachments),
        Date.now(),
      );
    const row = this.db
      .prepare(`SELECT ${columns} FROM queued_messages WHERE request_id=?`)
      .get(input.requestId) as Row;
    if (
      row.pane_id !== paneId ||
      row.session !== session ||
      row.text !== input.text ||
      row.attachments !== JSON.stringify(input.attachments)
    )
      return null;
    return decode(row);
  }

  get(paneId: string, session: string, id: string): QueueItem | null {
    const row = this.db
      .prepare(`SELECT ${columns} FROM queued_messages WHERE pane_id=? AND session=? AND id=?`)
      .get(paneId, session, id) as Row | undefined;
    return row ? decode(row) : null;
  }

  update(paneId: string, session: string, id: string, input: QueuedMessageInput): boolean {
    return (
      this.db
        .prepare(
          "UPDATE queued_messages SET text=?, attachments=?, error=NULL WHERE id=? AND pane_id=? AND session=? AND state='queued'",
        )
        .run(input.text, JSON.stringify(input.attachments), id, paneId, session).changes === 1
    );
  }

  remove(paneId: string, session: string, id: string): boolean {
    return (
      this.db
        .prepare(
          "DELETE FROM queued_messages WHERE id=? AND pane_id=? AND session=? AND state IN ('queued','failed')",
        )
        .run(id, paneId, session).changes === 1
    );
  }

  retry(paneId: string, session: string, id: string): boolean {
    return (
      this.db
        .prepare(
          "UPDATE queued_messages SET state='queued',error=NULL WHERE id=? AND pane_id=? AND session=? AND state IN ('failed','uncertain')",
        )
        .run(id, paneId, session).changes === 1
    );
  }

  // One atomic write wins across every Fernblick process sharing this database.
  // A sending/uncertain/submitted/failed row blocks later items for that session.
  claim(paneId: string, session: string, statusSequence: number): QueueItem | null {
    const row = this.db
      .prepare(`UPDATE queued_messages SET state='sending', status_sequence=?, claimed_at=?
      WHERE id=(SELECT id FROM queued_messages WHERE pane_id=? AND session=? AND state='queued'
        AND NOT EXISTS (SELECT 1 FROM queued_messages WHERE pane_id=? AND session=? AND state IN ('sending','submitted','uncertain','failed'))
        ORDER BY created_at, rowid LIMIT 1) AND state='queued' RETURNING ${columns}`)
      .get(statusSequence, Date.now(), paneId, session, paneId, session) as Row | undefined;
    return row ? decode(row) : null;
  }

  updateClaimSequence(id: string, sequence: number) {
    this.db
      .prepare("UPDATE queued_messages SET status_sequence=? WHERE id=? AND state='sending'")
      .run(sequence, id);
  }

  transition(id: string, from: QueueState, to: QueueState, error: string | null = null): boolean {
    return (
      this.db
        .prepare("UPDATE queued_messages SET state=?,error=? WHERE id=? AND state=?")
        .run(to, error, id, from).changes === 1
    );
  }

  // A different server can observe the completed agent status change and release the claim.
  completeSubmitted(paneId: string, session: string, statusSequence: number) {
    this.db
      .prepare(
        "UPDATE queued_messages SET state='delivered' WHERE pane_id=? AND session=? AND state='submitted' AND status_sequence < ?",
      )
      .run(paneId, session, statusSequence);
  }

  expireLostClaims(now = Date.now()) {
    this.db
      .prepare(
        "UPDATE queued_messages SET state='uncertain', error='Delivery confirmation timed out. Check the agent before retrying.' WHERE state='sending' AND claimed_at < ?",
      )
      .run(now - 120_000);
  }

  acknowledge(paneId: string, session: string, id: string): boolean {
    return (
      this.db
        .prepare(
          "UPDATE queued_messages SET state='delivered' WHERE id=? AND pane_id=? AND session=? AND state IN ('submitted','uncertain')",
        )
        .run(id, paneId, session).changes === 1
    );
  }

  hasWork() {
    return Boolean(
      this.db
        .prepare(
          "SELECT 1 FROM queued_messages WHERE state IN ('queued','submitted','sending') LIMIT 1",
        )
        .get(),
    );
  }
}
