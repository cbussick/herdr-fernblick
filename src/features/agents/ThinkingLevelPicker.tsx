import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Target, ThinkingLevel } from "../../../packages/pi-live-chat/protocol";
import {
  getAgentThinkingLevels,
  setAgentThinkingLevel,
  saveAgentGlobalDefault,
} from "../../shared/api/apiClient";
import { GlobalDefaultAction, GlobalDefaultsNotice } from "./GlobalDefaultAction";
import a11y from "../../styles/accessibility.module.css";
import { CloseIcon } from "../../shared/ui/Icons";
import styles from "./SessionSettingsPicker.module.css";

const labels: Record<ThinkingLevel, string> = {
  off: "Off",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
  max: "Max",
};

interface Props {
  pane: string;
  target: Target;
  enabled: boolean;
  supported: boolean;
  defaultsSupported?: boolean;
  model?: string;
  provider?: string;
  thinkingLevel?: ThinkingLevel;
  onClose: () => void;
}

export function ThinkingLevelPicker({
  pane,
  target,
  enabled,
  supported,
  defaultsSupported = false,
  model,
  provider,
  thinkingLevel,
  onClose,
}: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const options = useRef<(HTMLButtonElement | null)[]>([]);
  const mounted = useRef(false);
  const switching = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [savingDefault, setSavingDefault] = useState(false);
  const [savedDefault, setSavedDefault] = useState<ThinkingLevel>();
  const catalog = useQuery({
    queryKey: [
      "agent-thinking-levels",
      pane,
      target.runtime,
      target.sessionId,
      target.epoch,
      provider,
      model,
    ],
    queryFn: ({ signal }) => getAgentThinkingLevels(pane, target, signal),
    enabled: supported,
    retry: false,
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  useEffect(() => {
    mounted.current = true;
    const element = dialog.current;
    element?.showModal();
    return () => {
      mounted.current = false;
      element?.close();
    };
  }, []);
  const state = catalog.data;
  const current = thinkingLevel ?? state?.level;
  const canSaveDefault = defaultsSupported && Boolean(state?.defaults);
  const defaultLevel = savedDefault ?? state?.defaults?.thinkingLevel;
  const defaultUnavailable = state?.defaultsError ?? "Run /reload in Pi to enable row defaults.";
  const modelMatches = state && state.provider === provider && state.modelId === model;
  const ready =
    enabled && supported && modelMatches && !pending && !catalog.isFetching && !catalog.isError;
  useEffect(() => {
    if (state && modelMatches) {
      const index = state.levels.indexOf(state.level);
      options.current[Math.max(0, index)]?.focus({ preventScroll: true });
    }
  }, [state, modelMatches]);
  async function select(level: ThinkingLevel, saveDefault = false) {
    if (!ready || switching.current || (saveDefault && !canSaveDefault)) return;
    switching.current = true;
    setPending(true);
    setSavingDefault(saveDefault);
    setError("");
    try {
      if (saveDefault) {
        await saveAgentGlobalDefault(pane, target, {
          kind: "thinking",
          provider: state.provider,
          modelId: state.modelId,
          level,
        });
        if (mounted.current) setSavedDefault(level);
      } else {
        await setAgentThinkingLevel(pane, target, state.provider, state.modelId, level);
        if (mounted.current) onClose();
      }
    } catch (error) {
      if (mounted.current)
        setError(
          error instanceof Error
            ? error.message
            : "Thinking level change failed. Check Pi before trying again.",
        );
    } finally {
      switching.current = false;
      if (mounted.current) setPending(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-label="Choose thinking level"
      onClose={onClose}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <header className={styles.header}>
        <h2>Thinking level</h2>
        <button
          type="button"
          className={styles.close}
          aria-label="Close thinking level picker"
          onClick={onClose}
        >
          <CloseIcon />
        </button>
      </header>
      <p className={styles.notice}>
        Choose how much reasoning this agent uses. Available levels depend on its model.
      </p>
      {!supported ? (
        <p className={styles.notice}>Run /reload in Pi to enable thinking level selection.</p>
      ) : catalog.isFetching ? (
        <p className={styles.notice} role="status">
          Loading thinking levels…
        </p>
      ) : catalog.isError ? (
        <div className={styles.notice} role="alert">
          <p>{catalog.error.message}</p>
          <button type="button" onClick={() => void catalog.refetch()}>
            Retry
          </button>
        </div>
      ) : state ? (
        <>
          {!modelMatches ? (
            <p className={styles.notice} role="status">
              Model changed. Close and reopen Thinking level.
            </p>
          ) : null}
          {state.levels.length === 1 ? (
            <p className={styles.notice}>
              {state.levels[0] === "off"
                ? "This model does not support thinking."
                : "This model supports only one thinking level."}
            </p>
          ) : null}
          <GlobalDefaultsNotice
            available={canSaveDefault}
            error={state.defaultsError}
            onRetry={() => void catalog.refetch()}
            retryEnabled={!pending}
          />
          <div className={styles.list} aria-label="Available thinking levels">
            {state.levels.map((level, index) => (
              <div
                key={level}
                className={styles.row}
                data-current={level === current}
                data-testid="thinking-row"
              >
                <button
                  type="button"
                  className={styles.option}
                  ref={(element) => {
                    options.current[index] = element;
                  }}
                  aria-pressed={level === current}
                  disabled={!ready}
                  onClick={() => void select(level)}
                  onKeyDown={(event) => {
                    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
                      event.preventDefault();
                      const next =
                        event.key === "Home"
                          ? 0
                          : event.key === "End"
                            ? state.levels.length - 1
                            : (index + (event.key === "ArrowDown" ? 1 : -1) + state.levels.length) %
                              state.levels.length;
                      options.current[next]?.focus();
                    }
                  }}
                >
                  <strong>
                    {labels[level]}
                    {level === current ? " · Current" : ""}
                  </strong>
                </button>
                <GlobalDefaultAction
                  name={labels[level]}
                  enabled={Boolean(ready && canSaveDefault)}
                  saved={level === defaultLevel}
                  unavailableReason={canSaveDefault ? undefined : defaultUnavailable}
                  onSave={() => void select(level, true)}
                />
              </div>
            ))}
          </div>
        </>
      ) : null}
      {pending || savedDefault ? (
        <p className={pending ? styles.notice : a11y["sr-only"]} role="status">
          {pending
            ? savingDefault
              ? "Saving global default…"
              : "Changing thinking level…"
            : `${savedDefault ? labels[savedDefault] : ""} saved as global default.`}
        </p>
      ) : null}
      {!pending && !enabled ? <p className={styles.notice}>Available when Pi is idle.</p> : null}
      {error ? (
        <p className={styles.notice} role="alert">
          {error}
        </p>
      ) : null}
    </dialog>
  );
}
