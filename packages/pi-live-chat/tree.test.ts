import { SessionManager } from "@earendil-works/pi-coding-agent";
import { expect, it, vi } from "vitest";
import { matchesNavigationDestination } from "./tree.js";

it("accepts an unchanged destination, including an empty root and custom entry", () => {
  const manager = SessionManager.inMemory();
  expect(matchesNavigationDestination(manager, null)).toBe(true);
  const custom = manager.appendCustomEntry("original-state", {});
  expect(matchesNavigationDestination(manager, custom)).toBe(true);
  const message = manager.appendMessage({ role: "user", content: "Hello", timestamp: 1 });
  expect(matchesNavigationDestination(manager, message)).toBe(true);
});

it.each(["root", "entry"])(
  "accepts only extension state appended after the %s destination",
  (kind) => {
    const manager = SessionManager.inMemory();
    const destination =
      kind === "entry"
        ? manager.appendMessage({ role: "user", content: "Hello", timestamp: 1 })
        : null;
    manager.appendCustomEntry("plannotator", { phase: "idle" });
    manager.appendCustomEntry("other-extension", {});
    expect(matchesNavigationDestination(manager, destination)).toBe(true);
  },
);

it.each(["message", "custom-message", "compaction", "model", "thinking"])(
  "rejects %s changes even with extension state at the leaf",
  (kind) => {
    const manager = SessionManager.inMemory();
    const destination = manager.appendMessage({ role: "user", content: "Hello", timestamp: 1 });
    manager.appendCustomEntry("before-change", {});
    if (kind === "message")
      manager.appendMessage({ role: "user", content: "Another prompt", timestamp: 2 });
    if (kind === "custom-message")
      manager.appendCustomMessageEntry("extension", "New context", false);
    if (kind === "compaction") manager.appendCompaction("Summary", destination, 100);
    if (kind === "model") manager.appendModelChange("fixture", "changed-model");
    if (kind === "thinking") manager.appendThinkingLevelChange("high");
    manager.appendCustomEntry("after-change", {});
    expect(matchesNavigationDestination(manager, destination)).toBe(false);
  },
);

it("rejects a different branch even if its tail consists of extension state", () => {
  const manager = SessionManager.inMemory();
  const destination = manager.appendMessage({ role: "user", content: "Hello", timestamp: 1 });
  manager.resetLeaf();
  manager.appendCustomEntry("plannotator", { phase: "idle" });
  expect(matchesNavigationDestination(manager, destination)).toBe(false);
});

it.each(["missing", "cycle"])(
  "fails closed for a %s entry instead of accepting or looping",
  (kind) => {
    const manager = SessionManager.inMemory();
    const leaf = manager.appendCustomEntry("fixture", {});
    const entry = manager.getEntry(leaf)!;
    const lookup = vi
      .spyOn(manager, "getEntry")
      .mockReturnValue(kind === "missing" ? undefined : { ...entry, parentId: leaf });
    try {
      expect(matchesNavigationDestination(manager, null)).toBe(false);
    } finally {
      lookup.mockRestore();
    }
  },
);
