import a11yStyles from "../../styles/accessibility.module.css";
import consoleStyles from "./Console.module.css";
import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { KeyName, ShellTab } from "../../shared/api/contracts";
import { getPaneOutput, sendPaneInput, sendPaneKey } from "../../shared/api/apiClient";
import { CloseTabButton } from "./CloseTabButton";
import { BackIcon, SendIcon } from "../../shared/ui/Icons";
import { IconButton, TabKindIcon } from "../../shared/ui";
import { StateNotice } from "../../shared/ui/StateFeedback";
import { TerminalOutput } from "./TerminalOutput";
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
  const queryClient = useQueryClient();
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
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    inputMutation.mutate(command);
  }
  return (
    <main className={consoleStyles["console"]} data-testid="console" id="main-content">
      <header className={consoleStyles["console-header"]} data-testid="console-header">
        <IconButton label="Back to overview" onClick={onBack}>
          <BackIcon />
        </IconButton>
        <TabKindIcon kind="shell" />
        <div className={consoleStyles["console-header__copy"]}>
          <p>{tab.workspace_label ?? tab.workspace_id}</p>
          <div className={consoleStyles["console-header__title"]}>
            <h2>{tab.label}</h2>
          </div>
        </div>
        <CloseTabButton
          agentRunning={false}
          label={tab.label}
          tabId={tab.tab_id}
          onClosed={onBack}
        />
        <span className={consoleStyles["shell-status"]}>
          <i aria-hidden="true" />
          Shell
        </span>
      </header>
      <section
        className={consoleStyles["output-panel"] + " " + consoleStyles["output-panel--shell"]}
        data-testid="output-panel"
        aria-label="Terminal output"
      >
        <TerminalOutput
          key={tab.pane_id}
          queryKey={["pane-output", tab.pane_id]}
          read={(source, signal) => getPaneOutput(tab.pane_id, source, signal)}
          canLoadHistory
        />
      </section>
      <div className={consoleStyles["key-controls"]} aria-label="Terminal controls">
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
      <form className={consoleStyles["prompt-composer"]} onSubmit={submit}>
        <label htmlFor="shell-command" className={a11yStyles["sr-only"]}>
          Shell command
        </label>
        <div className={consoleStyles["prompt-composer__surface"]}>
          <div
            className={
              consoleStyles["prompt-composer__row"] +
              " " +
              consoleStyles["prompt-composer__row--shell"]
            }
          >
            <textarea
              id="shell-command"
              value={command}
              onChange={(event) => setCommand(event.target.value)}
              placeholder="Enter a shell command…"
              rows={1}
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
        </div>
        {inputMutation.isError ? (
          <StateNotice kind="unavailable" role="alert">
            {inputMutation.error.message}
          </StateNotice>
        ) : null}
        {keyMutation.isError ? (
          <StateNotice kind="unavailable" role="alert">
            {keyMutation.error.message}
          </StateNotice>
        ) : null}
      </form>
    </main>
  );
}
