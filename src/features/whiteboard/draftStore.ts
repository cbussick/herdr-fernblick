import { z } from "zod";
import { boardIdSchema, boardSceneSchema } from "../../../packages/pi-live-chat/boardProtocol";

const draftSchema = z.object({
  boardId: boardIdSchema,
  baseRevision: z.number().int().nonnegative(),
  scene: boardSceneSchema,
  instruction: z.string(),
  dirty: z.boolean(),
  baseScene: boardSceneSchema.optional(),
  paused: z.boolean().optional(),
  recovery: boardSceneSchema.optional(),
});
export type LocalDraft = z.infer<typeof draftSchema>;
export interface DraftStore {
  read(key: string): Promise<LocalDraft | undefined>;
  write(key: string, draft: LocalDraft): Promise<void>;
}

async function database() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    // Keep the deployed version: downgrading would break already-updated devices.
    const request = indexedDB.open("fernblick-whiteboards", 2);
    let abandoned = false;
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("drafts")) db.createObjectStore("drafts");
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => {
      abandoned = true;
      reject(new Error("Close other Fernblick tabs and reload to access local board storage"));
    };
    request.onsuccess = () => {
      const db = request.result;
      if (abandoned) {
        db.close();
        return;
      }
      db.onversionchange = () => db.close();
      resolve(db);
    };
  });
}
/** Clear this origin's saved drawings/recovery copies for a deleted conversation. */
export async function removeWhiteboardDrafts(sessionId: string | null, boardIds: string[]) {
  if (typeof indexedDB === "undefined") return;
  const ids = new Set(boardIds);
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("drafts", "readwrite");
      const request = tx.objectStore("drafts").openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        let sameSession = false;
        try {
          const key: unknown = typeof cursor.key === "string" ? JSON.parse(cursor.key) : null;
          sameSession = sessionId !== null && Array.isArray(key) && key[1] === sessionId;
        } catch {
          /* Older/unrecognized keys can still be matched by board ID. */
        }
        const value = cursor.value as { boardId?: unknown } | undefined;
        if (sameSession || (typeof value?.boardId === "string" && ids.has(value.boardId)))
          cursor.delete();
        cursor.continue();
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export const draftStore: DraftStore = {
  async read(key) {
    const db = await database();
    try {
      return await new Promise<LocalDraft | undefined>((resolve, reject) => {
        const tx = db.transaction("drafts", "readonly");
        const request = tx.objectStore("drafts").get(key);
        let result: LocalDraft | undefined;
        request.onsuccess = () => {
          const parsed = draftSchema.safeParse(request.result);
          if (request.result !== undefined && !parsed.success) {
            tx.abort();
            reject(new Error("Local draft is unreadable"));
            return;
          }
          result = parsed.success ? parsed.data : undefined;
        };
        tx.oncomplete = () => resolve(result);
        request.onerror = () => reject(request.error);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  },
  async write(key, draft) {
    const parsed = draftSchema.parse(draft);
    const db = await database();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction("drafts", "readwrite");
        tx.objectStore("drafts").put(parsed, key);
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error);
        tx.onerror = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  },
};
