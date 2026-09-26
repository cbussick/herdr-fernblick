import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { contentBlocks, readPiTranscript } from "./readPiTranscript.js";

describe("readPiTranscript", () => {
  it("displays a Pi session larger than 25 MB", async () => {
    const dir = await mkdtemp(join(homedir(), ".pi/agent/sessions/fernblick-test-"));
    const file = join(dir, "large.jsonl");
    try {
      const padding = "x".repeat(26_000_000);
      await writeFile(
        file,
        `${JSON.stringify({ type: "session", cwd: "/tmp", padding })}\n${JSON.stringify({ id: "user-1", parentId: null, type: "message", message: { role: "user", content: "Hello" } })}\n`,
      );
      const transcript = await readPiTranscript(file);
      expect(transcript.messages).toMatchObject([{ role: "user", text: "Hello" }]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("contentBlocks", () => {
  it("preserves separate thinking blocks", () => {
    const content = [
      { type: "thinking", thinking: "**First thought**" },
      { type: "toolCall", name: "read" },
      { type: "thinking", thinking: "**Second thought**\n\n**Third thought**" },
    ];

    expect(contentBlocks(content, "thinking")).toEqual([
      "**First thought**",
      "**Second thought**",
      "**Third thought**",
    ]);
  });

  it("keeps text content separate from thinking content", () => {
    const content = [
      { type: "thinking", thinking: "**Checking**" },
      { type: "text", text: "Done." },
    ];

    expect(contentBlocks(content, "text")).toEqual(["Done."]);
  });
});
