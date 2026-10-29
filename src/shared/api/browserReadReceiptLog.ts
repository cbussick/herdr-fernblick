import { runningBuild } from "../../pwa/buildInfo";
import {
  createReadReceiptDiagnostics,
  readReceiptRecordSchema,
  type ReadReceiptRecord,
} from "./readReceiptDiagnostics";

const PREFIX = "fernblick.read-log.v1.";
const storedRecordSchema = readReceiptRecordSchema.strict();
const MAX_BYTES = 128 * 1024;
const MAX_RECORDS = 200;
const MAX_AGE = 7 * 24 * 60 * 60 * 1000;

function entries(storage: Storage) {
  const found: { key: string; record: ReadReceiptRecord; bytes: number }[] = [];
  // Each attempt is a separate key: tabs don't overwrite a shared read/modify/write array.
  const keys = Array.from({ length: storage.length }, (_, i) => storage.key(i)).filter(
    (key): key is string => !!key?.startsWith(PREFIX),
  );
  for (const key of keys) {
    try {
      const raw = storage.getItem(key);
      const parsed =
        raw && raw.length <= MAX_BYTES ? storedRecordSchema.safeParse(JSON.parse(raw)) : null;
      if (
        !parsed?.success ||
        parsed.data.boundary !== "client" ||
        key !== PREFIX + parsed.data.requestId ||
        Date.parse(parsed.data.timestamp) < Date.now() - MAX_AGE ||
        Date.parse(parsed.data.timestamp) > Date.now() + 60_000
      ) {
        storage.removeItem(key);
        continue;
      }
      found.push({ key, record: parsed.data, bytes: raw!.length + key.length + 1 });
    } catch {
      storage.removeItem(key);
    }
  }
  found.sort(
    (a, b) => a.record.timestamp.localeCompare(b.record.timestamp) || a.key.localeCompare(b.key),
  );
  let bytes = found.reduce((total, item) => total + item.bytes, 2);
  while (found.length > MAX_RECORDS || bytes > MAX_BYTES) {
    const oldest = found.shift()!;
    bytes -= oldest.bytes;
    storage.removeItem(oldest.key);
  }
  return found.map((item) => item.record);
}

export function getReadReceiptHistory(): { available: boolean; records: ReadReceiptRecord[] } {
  try {
    return { available: true, records: entries(localStorage) };
  } catch {
    return { available: false, records: [] };
  }
}

export function subscribeReadReceiptHistory(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const changed = (event: StorageEvent) => {
    if (event.key === null || event.key?.startsWith(PREFIX)) listener();
  };
  window.addEventListener("storage", changed);
  return () => window.removeEventListener("storage", changed);
}

export function clearReadReceiptHistory(): boolean {
  try {
    const storage = localStorage;
    const keys = Array.from({ length: storage.length }, (_, i) => storage.key(i)).filter(
      (key): key is string => !!key?.startsWith(PREFIX),
    );
    for (const key of keys) storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

export function createBrowserReadReceiptDiagnostics() {
  return createReadReceiptDiagnostics({
    build: runningBuild.revision,
    console: true,
    sink(record) {
      // Prune before and after writing. No memory snapshot to resurrect cleared records.
      const storage = localStorage;
      entries(storage);
      const safe = readReceiptRecordSchema.parse(record);
      storage.setItem(PREFIX + safe.requestId, JSON.stringify(safe));
      entries(storage);
    },
  });
}
