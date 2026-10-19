import { SettingsManager } from "@earendil-works/pi-coding-agent";
import { globalDefaultsSchema, type DefaultSelection } from "./protocol.js";

// Read only explicit global defaults, never project overrides or the active
// session's settings. Only allowlisted metadata leaves the Pi process.
export function globalDefaultInfo(cwd: string) {
  try {
    const settings = SettingsManager.create(cwd, undefined, { projectTrusted: false });
    if (settings.drainErrors().length) throw new Error("Settings unavailable");
    const global = settings.getGlobalSettings();
    return {
      defaults: globalDefaultsSchema.parse({
        model:
          global.defaultProvider && global.defaultModel
            ? { provider: global.defaultProvider, modelId: global.defaultModel }
            : null,
        thinkingLevel: global.defaultThinkingLevel ?? null,
      }),
    };
  } catch {
    // Discovery must still allow session selection if settings cannot be read.
    return {
      defaultsError: "Global defaults unavailable. Check Pi settings JSON and permissions.",
    };
  }
}

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
