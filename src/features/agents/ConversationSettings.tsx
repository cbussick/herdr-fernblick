import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import type { Target, ThinkingLevel } from "../../../packages/pi-live-chat/protocol";
import { LightbulbIcon, ModelIcon } from "../../shared/ui/Icons";
import type { ConversationAction } from "./ConversationActionsMenu";
import { ModelPicker } from "./ModelPicker";
import { ThinkingLevelPicker } from "./ThinkingLevelPicker";

export interface ConversationSettingsProps {
  pane: string;
  target?: Target;
  connected: boolean;
  enabled: boolean;
  modelsSupported: boolean;
  thinkingSupported: boolean;
  model?: string;
  provider?: string;
  thinkingLevel?: ThinkingLevel;
}

export function ConversationSettings({
  settings,
  triggerRef,
  children,
}: {
  settings?: ConversationSettingsProps;
  triggerRef: RefObject<HTMLButtonElement | null>;
  children: (actions: ConversationAction[]) => ReactNode;
}) {
  const [picker, setPicker] = useState<"model" | "thinking" | null>(null);
  const key = JSON.stringify([settings?.pane, settings?.target, settings?.connected]);
  const [previousKey, setPreviousKey] = useState(key);
  if (key !== previousKey) {
    setPreviousKey(key);
    setPicker(null);
  }
  const modelKey = JSON.stringify([settings?.provider, settings?.model]);
  const [previousModel, setPreviousModel] = useState(modelKey);
  if (modelKey !== previousModel) {
    setPreviousModel(modelKey);
    if (picker === "thinking") setPicker(null);
  }
  const wasOpen = useRef(false);
  useEffect(() => {
    if (wasOpen.current && !picker) triggerRef.current?.focus({ preventScroll: true });
    wasOpen.current = Boolean(picker);
  }, [picker, triggerRef]);
  const disabledReason = !settings?.connected
    ? "Connect to Pi to change agent settings."
    : !settings.enabled
      ? "Available when Pi is idle and no other action is in progress."
      : undefined;
  const actions: ConversationAction[] = settings
    ? [
        {
          id: "model",
          label: "Model",
          icon: <ModelIcon />,
          disabledReason,
          onSelect: () => setPicker("model"),
        },
        {
          id: "thinking",
          label: "Thinking level",
          icon: <LightbulbIcon />,
          disabledReason,
          onSelect: () => setPicker("thinking"),
        },
      ]
    : [];
  return (
    <>
      {children(actions)}
      {picker && settings?.target && settings.connected ? (
        picker === "model" ? (
          <ModelPicker
            pane={settings.pane}
            target={settings.target}
            enabled={settings.enabled}
            supported={settings.modelsSupported}
            model={settings.model}
            provider={settings.provider}
            onClose={() => setPicker(null)}
          />
        ) : (
          <ThinkingLevelPicker
            pane={settings.pane}
            target={settings.target}
            enabled={settings.enabled}
            supported={settings.thinkingSupported}
            model={settings.model}
            provider={settings.provider}
            thinkingLevel={settings.thinkingLevel}
            onClose={() => setPicker(null)}
          />
        )
      ) : null}
    </>
  );
}
