import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { AgentModel, Target } from "../../../packages/pi-live-chat/protocol";
import { getAgentModels, setAgentModel } from "../../shared/api/apiClient";
import { CloseIcon, ModelIcon } from "../../shared/ui/Icons";
import styles from "./ModelPicker.module.css";

interface Props {
  pane: string;
  target?: Target;
  connected: boolean;
  supported: boolean;
  enabled: boolean;
  model?: string;
  provider?: string;
}

export function ModelPicker(props: Props) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  useEffect(() => {
    if (wasOpen.current && !open) trigger.current?.focus({ preventScroll: true });
    wasOpen.current = open;
  }, [open]);
  const key = JSON.stringify([props.pane, props.target, props.connected]);
  const [previousKey, setPreviousKey] = useState(key);
  if (key !== previousKey) {
    setPreviousKey(key);
    setOpen(false);
  }
  return (
    <>
      <button
        type="button"
        ref={trigger}
        className={styles.trigger}
        aria-label="Change model"
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={!props.connected || !props.enabled}
        title={
          !props.enabled
            ? "Change model when Pi is idle"
            : `Change model: ${props.model ?? "Unknown model"}`
        }
        onClick={() => setOpen(true)}
      >
        <ModelIcon />
      </button>
      {open && props.target ? (
        <ModelDialog {...props} target={props.target} onClose={() => setOpen(false)} />
      ) : null}
    </>
  );
}

function ModelDialog({
  pane,
  target,
  supported,
  enabled,
  model,
  provider,
  onClose,
}: Props & {
  target: Target;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const options = useRef<(HTMLButtonElement | null)[]>([]);
  const switching = useRef(false);
  const mounted = useRef(false);
  const [search, setSearch] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const catalog = useQuery({
    queryKey: ["agent-models", pane, target.runtime, target.sessionId, target.epoch],
    queryFn: ({ signal }) => getAgentModels(pane, target, signal),
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
    searchInput.current?.focus({ preventScroll: true });
    return () => {
      mounted.current = false;
      element?.close();
    };
  }, []);
  const models = (catalog.data?.models ?? []).filter((entry) =>
    `${entry.name} ${entry.id} ${entry.provider}`.toLowerCase().includes(search.toLowerCase()),
  );
  const ready = enabled && !pending && !catalog.isFetching && !catalog.isError;
  async function select(entry: AgentModel) {
    if (!ready || switching.current) return;
    switching.current = true;
    setPending(true);
    setError("");
    try {
      await setAgentModel(pane, target, entry.provider, entry.id);
      if (mounted.current) onClose();
    } catch (error) {
      if (mounted.current)
        setError(
          error instanceof Error
            ? error.message
            : "Model change failed. Check Pi before trying again.",
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
      aria-label="Choose model"
      onClose={onClose}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <header className={styles.header}>
        <h2>Model</h2>
        <button
          type="button"
          className={styles.close}
          aria-label="Close model picker"
          onClick={onClose}
        >
          <CloseIcon />
        </button>
      </header>
      <p className={styles.current}>
        Current: {provider ? `${provider} / ` : ""}
        {model ?? "Unknown model"}
      </p>
      {!supported ? (
        <p className={styles.notice}>Run /reload in Pi to enable model selection.</p>
      ) : (
        <>
          <input
            ref={searchInput}
            className={styles.search}
            type="search"
            aria-label="Search models"
            placeholder="Search models or providers"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => {
              // This dialog lives inside the composer form. Search Enter must
              // never submit the user's draft (including no-results/error states).
              if (event.key === "Enter") event.preventDefault();
              if (event.key === "ArrowDown" && ready) {
                event.preventDefault();
                options.current[0]?.focus();
              }
            }}
          />
          {catalog.isFetching ? (
            <p className={styles.notice} role="status">
              Loading models…
            </p>
          ) : catalog.isError ? (
            <div className={styles.notice} role="alert">
              <p>{catalog.error.message}</p>
              <button type="button" onClick={() => void catalog.refetch()}>
                Retry
              </button>
            </div>
          ) : (
            <div className={styles.list} aria-label="Available models">
              {models.map((entry, index) => {
                const current = entry.id === model && entry.provider === provider;
                return (
                  <button
                    key={`${entry.provider}/${entry.id}`}
                    type="button"
                    className={styles.option}
                    ref={(element) => {
                      options.current[index] = element;
                    }}
                    aria-pressed={current}
                    disabled={!ready}
                    onClick={() => void select(entry)}
                    onKeyDown={(event) => {
                      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
                        event.preventDefault();
                        const next =
                          event.key === "Home"
                            ? 0
                            : event.key === "End"
                              ? models.length - 1
                              : (index + (event.key === "ArrowDown" ? 1 : -1) + models.length) %
                                models.length;
                        options.current[next]?.focus();
                      }
                    }}
                  >
                    <strong>
                      {entry.name}
                      {current ? " · Current" : ""}
                    </strong>
                    <small>
                      {entry.provider} / {entry.id}
                    </small>
                  </button>
                );
              })}
              {!models.length ? (
                <p className={styles.notice}>
                  {catalog.data?.models.length
                    ? "No matching models."
                    : "No models available. Configure a provider in Pi first."}
                </p>
              ) : null}
            </div>
          )}
          {catalog.data?.truncated ? (
            <p className={styles.notice}>
              Showing the first 1,000 models. Use Pi for the full list.
            </p>
          ) : null}
        </>
      )}
      {pending ? (
        <p className={styles.notice} role="status">
          Changing model…
        </p>
      ) : !enabled ? (
        <p className={styles.notice}>Available when Pi is idle.</p>
      ) : null}
      {error ? (
        <p className={styles.notice} role="alert">
          {error}
        </p>
      ) : null}
    </dialog>
  );
}
