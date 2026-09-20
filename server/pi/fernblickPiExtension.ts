interface SessionEntry {
  id: string;
  parentId?: string | null;
  type?: string;
  message?: { role?: string; content?: unknown };
}

interface ExtensionContext {
  sessionManager: { getEntries(): SessionEntry[] };
  waitForIdle(): Promise<void>;
  navigateTree(targetId: string | null, options: { summarize: boolean }): Promise<unknown>;
}

interface ExtensionApi {
  registerCommand(
    name: string,
    command: {
      description: string;
      handler(args: string, context: ExtensionContext): Promise<void>;
    },
  ): void;
}

export default function fernblickPiExtension(pi: ExtensionApi) {
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
