import { isAbsolute, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { getImageUploadPath } from "../uploads/imageUploads.js";

interface SessionEntry {
  id: string;
  parentId?: string | null;
  type?: string;
  message?: { role?: string; content?: unknown };
}

interface ExtensionContext {
  sessionManager: { getEntries(): SessionEntry[]; getSessionFile(): string | undefined };
  isIdle(): boolean;
  waitForIdle(): Promise<void>;
  navigateTree(targetId: string | null, options: { summarize: boolean }): Promise<unknown>;
}

interface ExtensionApi {
  sendUserMessage(content: string, options?: { deliverAs: "followUp" }): void;
  registerCommand(
    name: string,
    command: {
      description: string;
      handler(args: string, context: ExtensionContext): Promise<void>;
    },
  ): void;
}

export default function fernblickPiExtension(pi: ExtensionApi) {
  pi.registerCommand("fernblick-deliver", {
    description: "Deliver a Fernblick message only to its intended Pi session",
    handler: async (args, context) => {
      const encoded = args.trim();
      if (!/^[A-Za-z0-9_-]{1,65000}$/.test(encoded))
        throw new Error("Invalid Fernblick delivery token");
      let payload: unknown;
      try {
        payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
      } catch {
        throw new Error("Invalid Fernblick delivery payload");
      }
      if (
        !payload ||
        typeof payload !== "object" ||
        !("id" in payload) ||
        typeof payload.id !== "string" ||
        !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(payload.id) ||
        !("expectedSession" in payload) ||
        typeof payload.expectedSession !== "string" ||
        !isAbsolute(payload.expectedSession) ||
        !("dbPath" in payload) ||
        typeof payload.dbPath !== "string" ||
        !isAbsolute(payload.dbPath)
      ) {
        throw new Error("Invalid Fernblick delivery payload");
      }
      const currentSession = context.sessionManager.getSessionFile();
      if (!currentSession || resolve(currentSession) !== resolve(payload.expectedSession)) {
        throw new Error("Fernblick message belongs to a different Pi session");
      }
      const db = new DatabaseSync(payload.dbPath, { readOnly: true });
      let row: { text: string; attachments: string } | undefined;
      try {
        row = db
          .prepare(
            "SELECT text, attachments FROM queued_messages WHERE id=? AND session=? AND state IN ('sending','submitted')",
          )
          .get(payload.id, payload.expectedSession) as typeof row;
      } finally {
        db.close();
      }
      if (!row || !row.text.trim() || row.text.length > 32_000) {
        throw new Error("Fernblick message is no longer available for delivery");
      }
      const attachments: unknown = JSON.parse(row.attachments);
      if (!Array.isArray(attachments) || !attachments.every((id) => typeof id === "string")) {
        throw new Error("Invalid Fernblick attachments");
      }
      const text = [row.text, ...attachments.map(getImageUploadPath)].join("\n");
      // No await between the in-process identity check and submission to Pi.
      pi.sendUserMessage(text, context.isIdle() ? undefined : { deliverAs: "followUp" });
    },
  });

  pi.registerCommand("fernblick-navigate", {
    description: "Navigate the session tree from Fernblick",
    handler: async (args, context) => {
      const targetId = args.trim();
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(targetId)) throw new Error("Invalid tree entry ID");
      const entry = context.sessionManager
        .getEntries()
        .find((candidate) => candidate.id === targetId);
      if (!entry) throw new Error("Tree entry no longer exists");

      await context.waitForIdle();
      if (entry.type === "message" && entry.message?.role === "user") {
        await context.navigateTree(entry.parentId ?? null, { summarize: false });
      } else {
        await context.navigateTree(targetId, { summarize: false });
      }
    },
  });
}
