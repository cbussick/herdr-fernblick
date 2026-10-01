import uiStyles from "./ui.module.css";
import type { ReactNode } from "react";
import { InfoIcon, LoaderIcon, MessageIcon, PlugOffIcon, SendIcon, TerminalIcon } from "./Icons";

const icons = {
  loading: LoaderIcon,
  unavailable: PlugOffIcon,
  empty: MessageIcon,
  terminal: TerminalIcon,
  sending: SendIcon,
  info: InfoIcon,
};
type StateKind = keyof typeof icons;

// Standalone placeholders use the same icon surface as overview empty states.
export function StateIcon({ kind, spinning = false }: { kind: StateKind; spinning?: boolean }) {
  const Icon = icons[kind];
  return (
    <span
      className={uiStyles["empty-state-icon"]}
      data-testid="empty-state-icon"
      data-spinning={spinning || undefined}
      data-state-kind={kind}
    >
      <Icon />
    </span>
  );
}

// Notices inside existing content stay compact so the conversation remains visible.
export function StateNotice({
  kind,
  children,
  role = "status",
}: {
  kind: StateKind;
  children: ReactNode;
  role?: "status" | "alert";
}) {
  const Icon = icons[kind];
  return (
    <div
      className={uiStyles["state-notice"]}
      data-ui="state-notice"
      data-state-kind={kind}
      data-tone={role === "alert" ? "error" : "info"}
      role={role}
    >
      <Icon />
      <span>{children}</span>
    </div>
  );
}
