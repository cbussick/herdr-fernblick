import { resolve } from "node:path";
import { BoardStore } from "../boards/storage.js";
import { removeImageUpload } from "../../packages/pi-live-chat/images.js";
import type { CatalogChat } from "./sessionCatalog.js";

/** Owns conversation cleanup, not project files or copies belonging to other chats. */
export class ChatArtifacts {
  constructor(
    private readonly boards: BoardStore,
    private readonly herdrSocket: string,
  ) {}

  async delete(chat: CatalogChat, otherChats: CatalogChat[]) {
    const sharedUploads = new Set(otherChats.flatMap((other) => other.uploadIds));
    const sharedBoards = new Set(otherChats.flatMap((other) => other.boardIds));
    const sameSession = otherChats.some((other) => other.sessionId === chat.sessionId);
    const key = JSON.stringify([resolve(this.herdrSocket), chat.sessionId]);
    const boardIds = sameSession
      ? []
      : await this.boards.deleteConversation(
          chat.sessionId,
          key,
          sharedBoards,
          new Set(chat.boardIds),
          new Set(otherChats.map((other) => other.sessionId)),
        );
    for (const id of chat.uploadIds) if (!sharedUploads.has(id)) await removeImageUpload(id);
    return { sessionId: sameSession ? null : chat.sessionId, boardIds };
  }
}
