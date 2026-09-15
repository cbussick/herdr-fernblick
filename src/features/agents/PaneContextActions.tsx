import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { closeTab, renameAgent, renameTab } from "../../shared/api/apiClient";
import { TrashIcon } from "../../shared/ui/Icons";

const agentNamePattern = /^[a-z][a-z0-9_-]{0,31}$/;

export function PaneContextActions({
  tabId,
  label,
  agentRunning,
  agentName,
  agentTarget,
  children,
}: {
  tabId: string;
  label: string;
  agentRunning: boolean;
  agentName?: string | null;
  agentTarget?: string;
  children: (handlers: {
    onContextMenu: (event: React.MouseEvent) => void;
    onPointerDown: (event: React.PointerEvent) => void;
    onPointerMove: () => void;
    onPointerUp: () => void;
    onClickCapture: (event: React.MouseEvent) => void;
  }) => ReactNode;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [dialog, setDialog] = useState<"rename" | "remove" | null>(null);
  const [nextLabel, setNextLabel] = useState(label);
  const [nextAgentName, setNextAgentName] = useState(agentName ?? "");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressClick = useRef(false);
  const renameDialogRef = useRef<HTMLDialogElement>(null);
  const removeDialogRef = useRef<HTMLDialogElement>(null);
  const queryClient = useQueryClient();
  const clear = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };
  useEffect(() => clear, []);
  useEffect(() => {
    const activeDialog = dialog === "rename" ? renameDialogRef.current : removeDialogRef.current;
    if (activeDialog && !activeDialog.open) activeDialog.showModal();
  }, [dialog]);
  const renameMutation = useMutation({
    mutationFn: async () => {
      const updates: Promise<void>[] = [];
      if (nextLabel.trim() !== label) updates.push(renameTab(tabId, nextLabel));
      if (agentRunning && agentTarget && nextAgentName && nextAgentName !== agentName) {
        updates.push(renameAgent(agentTarget, nextAgentName));
      }
      await Promise.all(updates);
    },
    onSuccess: () => {
      setDialog(null);
      void queryClient.invalidateQueries({ queryKey: ["agents"] });
    },
  });
  const closeMutation = useMutation({
    mutationFn: () => closeTab(tabId),
    onSuccess: () => {
      setDialog(null);
      void queryClient.invalidateQueries({ queryKey: ["agents"] });
    },
  });
  function submitRename(event: FormEvent) {
    event.preventDefault();
    renameMutation.mutate();
  }
  const handlers = {
    onContextMenu: (event: React.MouseEvent) => {
      event.preventDefault();
      setMenuOpen(true);
    },
    onPointerDown: (event: React.PointerEvent) => {
      if (event.pointerType !== "mouse")
        timer.current = setTimeout(() => {
          suppressClick.current = true;
          setMenuOpen(true);
          timer.current = null;
        }, 550);
    },
    onPointerMove: clear,
    onPointerUp: clear,
    onClickCapture: (event: React.MouseEvent) => {
      if (!suppressClick.current) return;
      event.preventDefault();
      event.stopPropagation();
      suppressClick.current = false;
    },
  };
  return (
    <div className="pane-row-context">
      {/* Handlers access refs only after pointer/click events, not during render. */}
      {/* oxlint-disable-next-line react/refs */}
      {children(handlers)}
      {menuOpen ? (
        <>
          <button
            className="pane-context-scrim"
            type="button"
            aria-label="Close menu"
            onClick={() => setMenuOpen(false)}
          />
          <div className="pane-context-menu" role="menu">
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                setNextLabel(label);
                setNextAgentName(agentName ?? "");
                setDialog("rename");
              }}
            >
              {agentRunning ? "Edit agent" : "Edit shell tab"}
            </button>
            <button
              type="button"
              role="menuitem"
              className="pane-context-menu__danger"
              onClick={() => {
                setMenuOpen(false);
                setDialog("remove");
              }}
            >
              Close tab
            </button>
          </div>
        </>
      ) : null}
      {dialog === "rename" ? (
        <dialog ref={renameDialogRef} className="context-dialog" onClose={() => setDialog(null)}>
          <form onSubmit={submitRename}>
            <h2>{agentRunning ? "Edit agent" : "Edit shell tab"}</h2>
            {agentRunning ? (
              <label>
                Agent name
                <input
                  value={nextAgentName}
                  onChange={(event) => setNextAgentName(event.target.value)}
                  placeholder="agent-name"
                  pattern="[a-z][a-z0-9_-]{0,31}"
                  maxLength={32}
                />
                <small>Lowercase letters, numbers, dashes, and underscores.</small>
              </label>
            ) : null}
            <label>
              Tab name
              <input
                autoFocus
                value={nextLabel}
                onChange={(event) => setNextLabel(event.target.value)}
                maxLength={80}
                required
              />
            </label>
            {renameMutation.isError ? <p role="alert">{renameMutation.error.message}</p> : null}
            <button
              type="button"
              className="edit-remove-button"
              onClick={() => setDialog("remove")}
            >
              <TrashIcon />
              Close this tab
            </button>
            <hr className="edit-dialog-divider" />
            <div>
              <button type="button" onClick={() => setDialog(null)}>
                Cancel
              </button>
              <button
                type="submit"
                disabled={
                  !nextLabel.trim() ||
                  (agentRunning && nextAgentName !== "" && !agentNamePattern.test(nextAgentName)) ||
                  renameMutation.isPending
                }
              >
                {renameMutation.isPending ? "Saving…" : "Save"}
              </button>
            </div>
          </form>
        </dialog>
      ) : null}
      {dialog === "remove" ? (
        <dialog ref={removeDialogRef} className="context-dialog" onClose={() => setDialog(null)}>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              closeMutation.mutate();
            }}
          >
            <h2>Close “{label}”?</h2>
            <p>
              {agentRunning
                ? "The running agent and its terminal session will end."
                : "The terminal session in this tab will end."}
            </p>
            {closeMutation.isError ? <p role="alert">{closeMutation.error.message}</p> : null}
            <div>
              <button type="button" onClick={() => setDialog(null)}>
                Cancel
              </button>
              <button
                type="submit"
                className="context-dialog__danger"
                disabled={closeMutation.isPending}
              >
                {closeMutation.isPending ? "Closing…" : "Close tab"}
              </button>
            </div>
          </form>
        </dialog>
      ) : null}
    </div>
  );
}
