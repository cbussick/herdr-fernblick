export interface GuardedPrompt {
  id: string;
  expectedSession: string;
  dbPath: string;
}

// Only an opaque message ID and database location cross the terminal. Pi loads
// the message itself after checking its current session inside the command handler.
export function encodeGuardedPrompt(payload: GuardedPrompt): string {
  return `/fernblick-deliver ${Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")}`;
}
