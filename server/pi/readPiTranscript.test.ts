import { describe, expect, it } from "vitest";
import { contentBlocks } from "./readPiTranscript.js";

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
