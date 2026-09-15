import {
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";
import type { AgentStatus } from "../../shared/api/contracts";
import { CloseIcon, PlusIcon, SearchIcon } from "./Icons";
import "./ui.css";

export function Button({
  variant = "primary",
  size = "default",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger";
  size?: "default" | "small";
}) {
  return (
    <button
      className={`button button--${variant} ${size === "small" ? "button--small" : ""} ${className}`}
      {...props}
    />
  );
}
export function IconButton({
  label,
  children,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; children: ReactNode }) {
  return (
    <button className={`icon-button ${className}`} aria-label={label} {...props}>
      {children}
    </button>
  );
}
export function StatusIndicator({
  status,
  label,
  hideLabel = false,
}: {
  status: AgentStatus;
  label: string;
  hideLabel?: boolean;
}) {
  return (
    <span className={`status-indicator status-indicator--${status}`}>
      <i className="status-indicator__dot" aria-hidden="true" />
      {hideLabel ? <span className="sr-only">{label}</span> : label}
    </span>
  );
}
export function TabKindIcon({ kind }: { kind: "agent" | "shell" }) {
  return (
    <span
      className={`tab-kind-icon ${kind === "shell" ? "tab-kind-icon--shell" : ""}`}
      aria-hidden="true"
    >
      {kind === "agent" ? "π" : ">_"}
    </span>
  );
}
export function SegmentedTabs<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div
      className="segmented-tabs"
      role="tablist"
      aria-label={label}
      style={{ "--tab-count": options.length } as CSSProperties}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
export function SearchField({
  label,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className="search-field">
      <span className="sr-only">{label}</span>
      <SearchIcon />
      <input type="search" aria-label={label} {...props} />
    </label>
  );
}
export function FormField({
  label,
  help,
  error,
  children,
}: {
  label: string;
  help?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="form-field">
      <label>{label}</label>
      {children}
      {help ? <small>{help}</small> : null}
      {error ? <small role="alert">{error}</small> : null}
    </div>
  );
}
export interface SpeedDialAction {
  id: string;
  label: string;
  description: string;
  kind: "agent" | "shell" | "workspace";
  onSelect: () => void;
}
export function SpeedDial({ actions }: { actions: SpeedDialAction[] }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);
  return (
    <div className="speed-dial" ref={rootRef}>
      {open ? (
        <div className="speed-dial__menu">
          {actions.map((action) => (
            <button
              className="speed-dial__item"
              key={action.id}
              type="button"
              onClick={() => {
                setOpen(false);
                action.onSelect();
              }}
            >
              <TabKindIcon kind={action.kind === "shell" ? "shell" : "agent"} />
              <span>
                <strong>{action.label}</strong>
                <small>{action.description}</small>
              </span>
            </button>
          ))}
        </div>
      ) : null}
      <button
        className="speed-dial__trigger"
        type="button"
        aria-expanded={open}
        aria-label={open ? "Close create menu" : "Open create menu"}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? <CloseIcon /> : <PlusIcon />}
      </button>
    </div>
  );
}
