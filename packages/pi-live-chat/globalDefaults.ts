import { SettingsManager } from "@earendil-works/pi-coding-agent";
import type { DefaultSelection } from "./protocol.js";

// Run inside the selected Pi process: its agent directory (including
// PI_CODING_AGENT_DIR), not Fernblick's environment, owns the global defaults.
export async function saveGlobalDefault(cwd: string, selection: DefaultSelection) {
  const settings = SettingsManager.create(cwd, undefined, { projectTrusted: false });
  const checkErrors = () => {
    if (settings.drainErrors().length)
      throw new Error(
        "Could not save Pi global defaults. Check settings JSON and file permissions.",
      );
  };
  checkErrors();
  // Pi merges only modified fields under its settings lock, preserving other
  // processes' preferences. Provider and model are saved in one operation.
  if (selection.kind === "model")
    settings.setDefaultModelAndProvider(selection.provider, selection.modelId);
  else settings.setDefaultThinkingLevel(selection.level);
  await settings.flush();
  checkErrors();
}
