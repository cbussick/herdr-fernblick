import { spawn } from "node:child_process";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export function localGraphicalSession(env: NodeJS.ProcessEnv): boolean {
  return !!(env.DISPLAY || env.WAYLAND_DISPLAY) && !env.SSH_CONNECTION && !env.SSH_TTY;
}

export async function openWhiteboardCommand(
  ctx: ExtensionContext,
  open: () => Promise<string>,
  env = process.env,
  launch = spawn,
): Promise<void> {
  try {
    const url = await open();
    // Always printable, including remote terminals and failed local openers.
    ctx.ui.notify(`Whiteboard: ${url}`, "info");
    if (localGraphicalSession(env)) {
      try {
        const child = launch("xdg-open", [url], { detached: true, stdio: "ignore", shell: false });
        child.on("error", () =>
          ctx.ui.notify(
            "Could not open browser. Open the printed whiteboard URL manually.",
            "warning",
          ),
        );
        child.unref();
      } catch {
        ctx.ui.notify(
          "Could not open browser. Open the printed whiteboard URL manually.",
          "warning",
        );
      }
    }
  } catch (error) {
    ctx.ui.notify(error instanceof Error ? error.message : "Whiteboard unavailable", "error");
  }
}
