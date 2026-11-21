import { ChildProcess } from "node:child_process";
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
    const ctx = { ui: { notify } };
    const child = new ChildProcess();
    const unref = vi.spyOn(child, "unref").mockImplementation(() => {});
    const launch = vi.fn(() => child);
    const open = vi.fn(async () => "https://example.test/?pane=w%3Ap&session=s&whiteboard=1");
    await openWhiteboardCommand(ctx, open, env, launch);
    expect(notify).toHaveBeenCalledWith(`Whiteboard: ${await open()}`, "info");
    if (localGraphicalSession(env)) {
      expect(launch).toHaveBeenCalledWith("xdg-open", [await open()], {
        detached: true,
        stdio: "ignore",
        shell: false,
      });
      expect(unref).toHaveBeenCalled();
    } else {
      expect(launch).not.toHaveBeenCalled();
    }
  },
);

it.each(["throw", "event"] as const)(
  "prints the URL and reports a local opener %s failure",
  async (failure) => {
    const notify = vi.fn();
    const child = new ChildProcess();
    const unref = vi.spyOn(child, "unref").mockImplementation(() => {});
    const launch = vi.fn(() => {
      if (failure === "throw") {
        throw new Error("opener unavailable");
      }
      return child;
    });
    await openWhiteboardCommand(
      { ui: { notify } },
      async () => "https://example.test/whiteboard",
      { DISPLAY: ":0" },
      launch,
    );
    if (failure === "event") {
      child.emit("error", new Error("opener unavailable"));
      expect(unref).toHaveBeenCalledOnce();
    } else {
      expect(unref).not.toHaveBeenCalled();
    }
    expect(notify.mock.calls).toEqual([
      ["Whiteboard: https://example.test/whiteboard", "info"],
      ["Could not open browser. Open the printed whiteboard URL manually.", "warning"],
    ]);
  },
);

it("prints actionable backend setup errors without opening a browser", async () => {
  const notify = vi.fn();
  const launch = vi.fn();
  await openWhiteboardCommand(
    { ui: { notify } },
    async () => {
      throw new Error("Set FERNBLICK_PUBLIC_URL on the backend");
    },
    { DISPLAY: ":0" },
    launch,
  );
  expect(notify).toHaveBeenCalledWith("Set FERNBLICK_PUBLIC_URL on the backend", "error");
  expect(launch).not.toHaveBeenCalled();
});
