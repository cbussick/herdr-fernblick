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

function legacyScene(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const scene = value as Record<string, unknown>;
  return (
    Array.isArray(scene.elements) && (scene.engine === undefined || scene.engine === "excalidraw")
  );
}

/** Intentionally destructive: the user retired Excalidraw and backed it up separately. */
function cleanDraft(raw: unknown): { value: unknown; changed: boolean } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { value: raw, changed: false };
  const draft = raw as Record<string, unknown>;
  if (legacyScene(draft.scene)) return { value: undefined, changed: true };
  if (
    !draft.scene ||
    typeof draft.scene !== "object" ||
    !("engine" in draft.scene) ||
    draft.scene.engine !== "react-flow"
  )
    return { value: raw, changed: false };
  const value = { ...draft };
  let changed = false;
  if (legacyScene(value.recovery)) {
    delete value.recovery;
    changed = true;
  }
  if (legacyScene(value.baseScene)) {
    // Keep the Flow drawing, but never merge it against an incompatible native base.
    delete value.baseScene;
    value.paused = true;
    changed = true;
  }
  return { value: changed ? value : raw, changed };
}

async function database() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    // Version two also fences off old version-one tabs: they cannot restore native drafts.
    const request = indexedDB.open("fernblick-whiteboards", 2);
    let abandoned = false;
    request.onupgradeneeded = () => {
      const db = request.result;
      const store = db.objectStoreNames.contains("drafts")
        ? request.transaction!.objectStore("drafts")
        : db.createObjectStore("drafts");
      const requestCursor = store.openCursor();
      requestCursor.onsuccess = () => {
        const cursor = requestCursor.result;
        if (!cursor) return;
        const cleaned = cleanDraft(cursor.value);
        if (cleaned.changed) {
          if (cleaned.value === undefined) cursor.delete();
          else cursor.update(cleaned.value);
        }
        cursor.continue();
      };
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => {
      abandoned = true;
      reject(new Error("Close other Fernblick tabs and reload to clear old board storage"));
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
        const tx = db.transaction("drafts", "readwrite");
        const store = tx.objectStore("drafts");
        const request = store.get(key);
        let result: LocalDraft | undefined;
        request.onsuccess = () => {
          const cleaned = cleanDraft(request.result);
          const parsed = draftSchema.safeParse(cleaned.value);
          if (cleaned.value !== undefined && !parsed.success) {
            tx.abort();
            reject(new Error("Local draft is unreadable"));
            return;
          }
          if (cleaned.changed) {
            if (cleaned.value === undefined) store.delete(key);
            else store.put(cleaned.value, key);
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
    const db = await database();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction("drafts", "readwrite");
        const cleaned = cleanDraft(draft);
        if (cleaned.changed && cleaned.value === undefined) tx.objectStore("drafts").delete(key);
        else tx.objectStore("drafts").put(draftSchema.parse(cleaned.value), key);
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error);
        tx.onerror = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  },
};
