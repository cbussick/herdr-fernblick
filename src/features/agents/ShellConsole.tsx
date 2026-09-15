import { useEffect, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { KeyName, ShellTab } from "../../shared/api/contracts";
import { getPaneOutput, sendPaneInput, sendPaneKey } from "../../shared/api/apiClient";
import { CloseTabButton } from "./CloseTabButton";
import { BackIcon, SendIcon } from "../../shared/ui/Icons";
import { IconButton, TabKindIcon } from "../../shared/ui";
interface ShellConsoleProps {
  tab: ShellTab;
  onBack: () => void;
}
const controls: { key: KeyName; label: string }[] = [
  { key: "esc", label: "Esc" },
  { key: "ctrl+c", label: "Ctrl+C" },
  { key: "up", label: "↑" },
  { key: "down", label: "↓" },
  { key: "enter", label: "Enter" },
];
export function ShellConsole({ tab, onBack }: ShellConsoleProps) {
  const [command, setCommand] = useState("");
  const outputRef = useRef<HTMLPreElement>(null);
  const queryClient = useQueryClient();
  const outputQuery = useQuery({
    queryKey: ["pane-output", tab.pane_id],
    queryFn: () => getPaneOutput(tab.pane_id),
    refetchInterval: 1000,
  });
  const inputMutation = useMutation({
    mutationFn: (text: string) => sendPaneInput(tab.pane_id, text),
    onSuccess: () => {
      setCommand("");
      void queryClient.invalidateQueries({ queryKey: ["pane-output", tab.pane_id] });
    },
  });
  const keyMutation = useMutation({
    mutationFn: (key: KeyName) => sendPaneKey(tab.pane_id, key),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["pane-output", tab.pane_id] }),
  });
  useEffect(() => {
    const output = outputRef.current;
    if (output) output.scrollTop = output.scrollHeight;
  }, [outputQuery.data?.revision]);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    inputMutation.mutate(command);
  }
  return (
    <main className="console" id="main-content">
      <header className="console-header">
        <IconButton label="Back to overview" onClick={onBack}>
          <BackIcon />
        </IconButton>
        <TabKindIcon kind="shell" />
        <div className="console-header__copy">
          <p>{tab.workspace_label ?? tab.workspace_id}</p>
          <div className="console-header__title">
            <h2>{tab.label}</h2>
          </div>
        </div>
        <CloseTabButton
          agentRunning={false}
          label={tab.label}
          tabId={tab.tab_id}
          onClosed={onBack}
        />
        <span className="shell-status">
          <i aria-hidden="true" />
          Shell
        </span>
      </header>
      <section className="output-panel output-panel--shell" aria-label="Terminal output">
        <div className="output-panel__bar">
          <span>Terminal output</span>
          <span>ANSI</span>
        </div>
        {outputQuery.isPending ? (
          <div className="terminal-state" aria-busy="true">
            Reading terminal…
          </div>
        ) : outputQuery.isError ? (
          <div className="terminal-state terminal-state--error" role="alert">
            Could not read this tab. {outputQuery.error.message}
          </div>
        ) : (
          <pre ref={outputRef} className="terminal-output" tabIndex={0}>
            {outputQuery.data.text || "No terminal output yet."}
          </pre>
        )}
      </section>
      <div className="key-controls" aria-label="Terminal controls">
        {controls.map((control) => (
          <button
            type="button"
            key={control.key}
            disabled={keyMutation.isPending}
            onClick={() => keyMutation.mutate(control.key)}
          >
            {control.label}
          </button>
        ))}
      </div>
      <form className="prompt-composer" onSubmit={submit}>
        <label htmlFor="shell-command" className="sr-only">
          Shell command
        </label>
        <div className="prompt-composer__row">
          <textarea
            id="shell-command"
            value={command}
            onChange={(event) => setCommand(event.target.value)}
            placeholder="Enter a shell command…"
            rows={2}
            maxLength={32000}
            disabled={inputMutation.isPending}
          />
          <button
            type="submit"
            aria-label="Run command"
            disabled={!command.trim() || inputMutation.isPending}
          >
            <SendIcon />
          </button>
        </div>
        {inputMutation.isError ? <p role="alert">{inputMutation.error.message}</p> : null}
        {keyMutation.isError ? <p role="alert">{keyMutation.error.message}</p> : null}
      </form>
    </main>
  );
}
