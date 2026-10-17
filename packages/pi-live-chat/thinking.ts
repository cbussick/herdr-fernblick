import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai/compat";
import { thinkingStateSchema } from "./protocol.js";

// Use the host's own capability rules, including custom thinkingLevelMap values.
// Never probe capabilities by changing the live agent's level.
export function thinkingState(pi: ExtensionAPI, ctx: ExtensionContext) {
  const model = ctx.model;
  if (!model) throw new Error("Select a model in Pi before choosing a thinking level");
  return thinkingStateSchema.parse({
    provider: model.provider,
    modelId: model.id,
    level: pi.getThinkingLevel(),
    levels: getSupportedThinkingLevels(model),
  });
}
