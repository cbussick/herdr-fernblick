import type { spawn } from "node:child_process";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { expect, it, vi } from "vitest";
import { localGraphicalSession, openWhiteboardCommand } from "./whiteboardCommand.js";

it.each([
  [{}, false],
  [{ DISPLAY: ":0" }, true],
  [{ WAYLAND_DISPLAY: "wayland-0" }, true],
  [{ DISPLAY: ":0", SSH_CONNECTION: "remote" }, false],
  [{ WAYLAND_DISPLAY: "wayland-0", SSH_TTY: "/dev/pts/1" }, false],
] as const)("detects local graphical sessions without guessing over SSH: %j", (env, expected) => {
  expect(localGraphicalSession(env)).toBe(expected);
});

it.each([{}, { DISPLAY: ":0", SSH_CONNECTION: "remote" }, { DISPLAY: ":0" }])(
  "always prints the URL, only launches locally, and never touches a draft or prompt: %j",
  async (env) => {
    const notify = vi.fn();
    const ctx = { ui: { notify } } as unknown as ExtensionContext;
    const child = { on: vi.fn(), unref: vi.fn() };
    const launch = vi.fn(() => child);
    const open = vi.fn(async () => "https://example.test/?pane=w%3Ap&session=s&whiteboard=1");
    await openWhiteboardCommand(ctx, open, env, launch as unknown as typeof spawn);
    expect(notify).toHaveBeenCalledWith(`Whiteboard: ${await open()}`, "info");
    if (localGraphicalSession(env)) {
      expect(launch).toHaveBeenCalledWith("xdg-open", [await open()], {
        detached: true,
        stdio: "ignore",
        shell: false,
      });
      expect(child.unref).toHaveBeenCalled();
    } else expect(launch).not.toHaveBeenCalled();
  },
);

it("prints actionable backend setup errors without opening a browser", async () => {
  const notify = vi.fn();
  const launch = vi.fn();
  await openWhiteboardCommand(
    { ui: { notify } } as unknown as ExtensionContext,
    async () => {
      throw new Error("Set FERNBLICK_PUBLIC_URL on the backend");
    },
    { DISPLAY: ":0" },
    launch as unknown as typeof spawn,
  );
  expect(notify).toHaveBeenCalledWith("Set FERNBLICK_PUBLIC_URL on the backend", "error");
  expect(launch).not.toHaveBeenCalled();
});
