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
    const request = indexedDB.open("fernblick-whiteboards", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("drafts");
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Local draft storage is blocked"));
    request.onsuccess = () => resolve(request.result);
  });
}
export const draftStore: DraftStore = {
  async read(key) {
    const db = await database();
    try {
      return await new Promise<LocalDraft | undefined>((resolve, reject) => {
        const tx = db.transaction("drafts", "readonly");
        const request = tx.objectStore("drafts").get(key);
        request.onsuccess = () => {
          const parsed = draftSchema.safeParse(request.result);
          if (request.result !== undefined && !parsed.success)
            reject(new Error("Local draft is unreadable"));
          else resolve(parsed.success ? parsed.data : undefined);
        };
        request.onerror = () => reject(request.error);
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
        tx.objectStore("drafts").put(draftSchema.parse(draft), key);
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error);
        tx.onerror = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  },
};
