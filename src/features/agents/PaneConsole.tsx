import { useCallback, useRef, useState } from "react";
import type { ComponentProps, Dispatch, RefCallback, SetStateAction } from "react";
import type { ShellTab } from "../../shared/api/contracts";
import { AgentConsole } from "./AgentConsole";
import { ShellConsole } from "./ShellConsole";

export interface PaneComposer {
  text: string;
  setText: Dispatch<SetStateAction<string>>;
  inputRef: RefCallback<HTMLTextAreaElement>;
}

type Props = Omit<ComponentProps<typeof AgentConsole>, "agent" | "composer"> & {
  agent?: ComponentProps<typeof AgentConsole>["agent"];
  tab?: ShellTab | null;
};

// App keys this boundary by pane, not by whether startup has detected Pi yet.
export function PaneConsole({ agent, tab, ...props }: Props) {
  const [text, setText] = useState("");
  const selection = useRef<{
    start: number;
    end: number;
    direction: "forward" | "backward" | "none";
  } | null>(null);
  const inputRef = useCallback<RefCallback<HTMLTextAreaElement>>((node) => {
    if (!node) {
      return;
    }
    if (selection.current) {
      const { start, end, direction } = selection.current;
      selection.current = null;
      node.focus({ preventScroll: true });
      node.setSelectionRange(start, end, direction);
    }
    return () => {
      // Do not steal focus if the user moved to another control during startup.
      selection.current =
        node.ownerDocument.activeElement === node
          ? {
              start: node.selectionStart,
              end: node.selectionEnd,
              direction: node.selectionDirection,
            }
          : null;
    };
  }, []);
  const composer = { text, setText, inputRef };
  return agent ? (
    <AgentConsole {...props} agent={agent} composer={composer} />
  ) : tab ? (
    <ShellConsole tab={tab} onBack={props.onBack} composer={composer} />
  ) : null;
}
