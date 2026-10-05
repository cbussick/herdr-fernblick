import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { TerminalOutput as Output, TerminalReadSource } from "../../shared/api/contracts";
import { StateIcon, StateNotice } from "../../shared/ui/StateFeedback";
import styles from "./Console.module.css";

interface TerminalOutputProps {
  queryKey: readonly string[];
  read: (source: TerminalReadSource, signal?: AbortSignal) => Promise<Output>;
  canLoadHistory: boolean;
  historyBlockedReason?: string;
}

// Mount with a key identifying the pane/session so snapshots and late reads
// never carry over to a different terminal.
export function TerminalOutput({
  queryKey,
  read,
  canLoadHistory,
  historyBlockedReason = "Load history when the agent is idle.",
}: TerminalOutputProps) {
  const [mode, setMode] = useState<"live" | "history">("live");
  const [history, setHistory] = useState<Output>();
  const outputRef = useRef<HTMLPreElement>(null);
  const follow = useRef(true);
  const historyController = useRef<AbortController | null>(null);
  useEffect(() => () => historyController.current?.abort(), []);
  const loadHistory = useMutation({
    mutationFn: () => {
      historyController.current = new AbortController();
      return read("recent_unwrapped", historyController.current.signal);
    },
    onSuccess: (output) => {
      setHistory(output);
      setMode("history");
    },
    retry: false,
    gcTime: 0,
  });
  const live = useQuery({
    queryKey: [...queryKey, "visible"],
    queryFn: ({ signal }) => read("visible", signal),
    enabled: mode === "live" && !loadHistory.isPending,
    refetchInterval: mode === "live" && !loadHistory.isPending ? 1000 : false,
    retry: false,
  });
  const output = mode === "history" ? history : live.data;
  useEffect(() => {
    if (mode === "live" && follow.current && outputRef.current)
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
  }, [mode, output?.revision]);

  return (
    <>
      <div className={styles["terminal-header"]}>
        <div className={styles["output-panel__bar"]}>
          <span>{mode === "live" ? "Live screen" : "History snapshot"}</span>
          <div className={styles["terminal-actions"]}>
            {mode === "history" ? (
              <button
                type="button"
                disabled={loadHistory.isPending}
                onClick={() => {
                  follow.current = true;
                  loadHistory.reset();
                  setMode("live");
                }}
              >
                Return to live
              </button>
            ) : null}
            <button
              type="button"
              disabled={!canLoadHistory || loadHistory.isPending}
              title={!canLoadHistory ? historyBlockedReason : "Load up to 600 lines of history"}
              onClick={() => {
                if (canLoadHistory && !loadHistory.isPending) loadHistory.mutate();
              }}
            >
              {loadHistory.isPending
                ? "Loading history…"
                : history
                  ? "Refresh history"
                  : "Load history"}
            </button>
          </div>
        </div>
        <p className={styles["terminal-hint"]}>
          {mode === "history"
            ? "Saved snapshot, up to 600 lines. Return to live for current output."
            : canLoadHistory
              ? "Current screen only. Load history to scroll through older output."
              : historyBlockedReason}
        </p>
        {loadHistory.isError ? (
          <StateNotice kind="unavailable" role="alert">
            {loadHistory.error.message}
          </StateNotice>
        ) : null}
        {mode === "live" && live.isError ? (
          <StateNotice kind="unavailable" role="alert">
            {live.error.message}
          </StateNotice>
        ) : null}
      </div>
      {output?.text ? (
        <pre
          ref={outputRef}
          className={styles["terminal-output"]}
          tabIndex={0}
          aria-label={mode === "live" ? "Live terminal screen" : "Terminal history snapshot"}
          onScroll={() => {
            const el = outputRef.current;
            if (el) follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
          }}
        >
          {output.text}
        </pre>
      ) : (
        <div className={styles["terminal-state"]} aria-busy={mode === "live" && live.isPending}>
          <StateIcon kind={mode === "live" && live.isPending ? "loading" : "terminal"} />
          <p>
            {mode === "live" && live.isPending ? "Reading terminal…" : "No terminal output yet."}
          </p>
        </div>
      )}
    </>
  );
}
