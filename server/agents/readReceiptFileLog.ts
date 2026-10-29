import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, realpath, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  readReceiptRecordSchema,
  safeReadReceiptErrorCode,
  type ReadReceiptRecord,
} from "../../src/shared/api/readReceiptDiagnostics.js";

const FILE =
  /^read-receipt\.(\d{13})-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.ndjson$/;
const DAY = 24 * 60 * 60 * 1000;
type Options = {
  directory: string;
  maxBytes?: number;
  fileBytes?: number;
  ageMs?: number;
  segmentMs?: number;
};

/** One backend per directory. Bounded async writer: receipt requests never await disk logging. */
export class ReadReceiptFileLog {
  private readonly directory: string;
  private readonly maxBytes: number;
  private readonly fileBytes: number;
  private readonly ageMs: number;
  private readonly segmentMs: number;
  private readonly queue: ReadReceiptRecord[] = [];
  private dropped = 0;
  private active: { name: string; started: number; bytes: number } | undefined;
  private pump: Promise<void> | undefined;
  private maintenance = true;
  private closed = false;
  private warningAt = -Infinity;
  private readonly timer: ReturnType<typeof setInterval>;

  constructor(options: Options) {
    this.directory = resolve(options.directory);
    this.maxBytes = options.maxBytes ?? 100 * 1024 * 1024;
    this.fileBytes = Math.min(options.fileBytes ?? 1024 * 1024, this.maxBytes);
    this.ageMs = options.ageMs ?? 7 * DAY;
    this.segmentMs = options.segmentMs ?? 60 * 60_000;
    this.timer = setInterval(() => {
      this.maintenance = true;
      this.start();
    }, 60_000);
    this.timer.unref();
    this.start();
  }

  write = (value: ReadReceiptRecord) => {
    const record = readReceiptRecordSchema.safeParse(value);
    if (
      this.closed ||
      !record.success ||
      (record.data.severity === "info" &&
        this.queue.filter((item) => item.severity === "info").length >= 64)
    ) {
      this.dropped = Math.min(this.dropped + 1, Number.MAX_SAFE_INTEGER);
      return;
    }
    if (this.queue.length >= 128) {
      const routine = this.queue.findIndex((item) => item.severity === "info");
      this.dropped = Math.min(this.dropped + 1, Number.MAX_SAFE_INTEGER);
      if (record.data.severity === "info" || routine === -1) return;
      this.queue.splice(routine, 1);
    }
    // Records have a fixed schema and a <2 KiB encoded size; no unbounded payload queue.
    this.queue.push(record.data);
    this.start();
  };

  async flush() {
    while (this.pump) await this.pump;
  }

  async close() {
    this.closed = true;
    clearInterval(this.timer);
    await this.flush();
  }

  private start() {
    if (this.pump) return;
    this.pump = Promise.resolve()
      .then(() => this.drain())
      .finally(() => {
        this.pump = undefined;
        if (this.queue.length || this.maintenance) this.start();
      });
  }

  private async prepare() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const info = await lstat(this.directory);
    if (
      !info.isDirectory() ||
      info.isSymbolicLink() ||
      info.uid !== process.getuid?.() ||
      (info.mode & 0o777) !== 0o700 ||
      (await realpath(this.directory)) !== this.directory
    )
      throw new Error("Unsafe log directory");
  }

  private warn(error: unknown) {
    if (Date.now() - this.warningAt < 60_000) return;
    this.warningAt = Date.now();
    try {
      // No recursion into the file logger, no messages/paths, at most once a minute.
      console.warn(
        JSON.stringify({
          event: "read_receipt_log_unavailable",
          category: "storage",
          timestamp: new Date().toISOString(),
          errorCode: safeReadReceiptErrorCode(error),
        }),
      );
    } catch {
      /* No effect on application behavior. */
    }
  }

  private async prune(incoming = 0) {
    await this.prepare();
    const files: { name: string; started: number; bytes: number }[] = [];
    for (const name of await readdir(this.directory)) {
      const match = FILE.exec(name);
      if (!match) continue;
      const info = await lstat(join(this.directory, name));
      if (
        !info.isFile() ||
        info.uid !== process.getuid?.() ||
        (info.mode & 0o777) !== 0o600 ||
        info.nlink !== 1
      )
        throw new Error("Unsafe log file");
      const started = Number(match[1]);
      // Segments start with event collection time; never retain an old segment by touching it.
      if (started < Date.now() - this.ageMs || started > Date.now() + 60_000) {
        await unlink(join(this.directory, name));
        if (this.active?.name === name) this.active = undefined;
      } else files.push({ name, started, bytes: info.size });
    }
    files.sort((a, b) => a.started - b.started || a.name.localeCompare(b.name));
    let bytes = files.reduce((sum, file) => sum + file.bytes, incoming);
    while (bytes > this.maxBytes && files.length) {
      const oldest = files.shift()!;
      await unlink(join(this.directory, oldest.name));
      if (this.active?.name === oldest.name) this.active = undefined;
      bytes -= oldest.bytes;
    }
  }

  private async append(record: ReadReceiptRecord) {
    const missed = this.dropped;
    const line =
      JSON.stringify({
        ...record,
        dropped: Math.min(Number.MAX_SAFE_INTEGER, record.dropped + missed),
      }) + "\n";
    const bytes = Buffer.byteLength(line);
    if (bytes > this.fileBytes) throw new Error("Log record exceeds segment budget");
    await this.prepare();
    const now = Date.now();
    if (
      !this.active ||
      this.active.bytes + bytes > this.fileBytes ||
      now - this.active.started >= this.segmentMs
    ) {
      // Reserve a whole segment, avoiding a directory scan on every event.
      await this.prune(this.fileBytes);
      this.active = { name: `read-receipt.${now}-${randomUUID()}.ndjson`, started: now, bytes: 0 };
    }
    const active = this.active;
    const file = await open(
      join(this.directory, active.name),
      constants.O_WRONLY |
        constants.O_APPEND |
        constants.O_NOFOLLOW |
        constants.O_NONBLOCK |
        (active.bytes === 0 ? constants.O_CREAT | constants.O_EXCL : 0),
      0o600,
    );
    try {
      const info = await file.stat();
      if (
        !info.isFile() ||
        info.uid !== process.getuid?.() ||
        (info.mode & 0o777) !== 0o600 ||
        info.nlink !== 1 ||
        info.size !== active.bytes
      )
        throw new Error("Unsafe log file");
      await file.writeFile(line);
      active.bytes += bytes;
      this.dropped = Math.max(0, this.dropped - missed);
    } catch (error) {
      // Never append after a possibly partial record. A new segment starts next time.
      this.active = undefined;
      throw error;
    } finally {
      await file.close();
    }
  }

  private async drain() {
    if (this.maintenance) {
      this.maintenance = false;
      try {
        await this.prune();
      } catch (error) {
        this.warn(error);
      }
    }
    while (this.queue.length) {
      const record = this.queue.shift()!;
      try {
        await this.append(record);
      } catch (error) {
        this.active = undefined;
        this.dropped = Math.min(this.dropped + 1, Number.MAX_SAFE_INTEGER);
        this.warn(error);
      }
    }
  }
}
