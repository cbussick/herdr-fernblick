import dialogStyles from "./Dialogs.module.css";
import overviewStyles from "./agentOverview.module.css";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
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
  const rowRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
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
  useLayoutEffect(() => {
    const popup = menuRef.current;
    const row = rowRef.current;
    const overlay = overlayRef.current;
    if (!menuOpen || !popup || !row || !overlay) return;
    // Top-layer placement escapes workspace and overview overflow clipping.
    // Manual dismissal keeps the release of the opening long press/right click
    // from immediately light-dismissing a newly opened popover.
    overlay.showPopover();
    function position() {
      const viewport = window.visualViewport;
      const minX = (viewport?.offsetLeft ?? 0) + 8;
      const minY = (viewport?.offsetTop ?? 0) + 8;
      const maxX = minX + (viewport?.width ?? window.innerWidth) - 16;
      const maxY = minY + (viewport?.height ?? window.innerHeight) - 16;
      const rect = row!.getBoundingClientRect();
      popup!.style.setProperty("--pane-menu-max-width", `${maxX - minX}px`);
      popup!.style.setProperty("--pane-menu-max-height", `${maxY - minY}px`);
      const { width, height } = popup!.getBoundingClientRect();
      const above = rect.top - minY - 8;
      const below = maxY - rect.bottom - 8;
      const placeAbove = below < height && above > below;
      popup!.style.setProperty(
        "--pane-menu-max-height",
        `${Math.max(0, Math.min(maxY - minY, placeAbove ? above : below))}px`,
      );
      const visibleHeight = popup!.getBoundingClientRect().height;
      const top = placeAbove ? rect.top - visibleHeight - 8 : rect.bottom + 8;
      popup!.style.setProperty(
        "--pane-menu-top",
        `${Math.max(minY, Math.min(top, maxY - visibleHeight))}px`,
      );
      popup!.style.setProperty(
        "--pane-menu-left",
        `${Math.max(minX, Math.min(rect.right - width - 8, maxX - width))}px`,
      );
    }
    position();
    popup.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    const viewport = window.visualViewport;
    viewport?.addEventListener("resize", position);
    viewport?.addEventListener("scroll", position);
    const observer = new ResizeObserver(position);
    observer.observe(row);
    observer.observe(popup);
    return () => {
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
      viewport?.removeEventListener("resize", position);
      viewport?.removeEventListener("scroll", position);
      observer.disconnect();
      if (overlay.matches(":popover-open")) overlay.hidePopover();
    };
  }, [menuOpen]);
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
      clear();
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
    <div ref={rowRef} className={overviewStyles["pane-row-context"]}>
      {/* Handlers access refs only after pointer/click events, not during render. */}
      {/* oxlint-disable-next-line react/refs */}
      {children(handlers)}
      {menuOpen ? (
        <div
          ref={overlayRef}
          className={overviewStyles["pane-context-overlay"]}
          popover="manual"
          onKeyDown={(event) => {
            if (event.key === "Escape" || event.key === "Tab") {
              if (event.key === "Escape") event.preventDefault();
              setMenuOpen(false);
              rowRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
            }
          }}
        >
          <button
            className={overviewStyles["pane-context-scrim"]}
            type="button"
            tabIndex={-1}
            aria-label="Close menu"
            onClick={() => setMenuOpen(false)}
          />
          <div
            ref={menuRef}
            className={overviewStyles["pane-context-menu"]}
            role="menu"
            aria-label={`${label} actions`}
          >
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
              className={overviewStyles["pane-context-menu__danger"]}
              onClick={() => {
                setMenuOpen(false);
                setDialog("remove");
              }}
            >
              Close tab
            </button>
          </div>
        </div>
      ) : null}
      {dialog === "rename" ? (
        <dialog
          ref={renameDialogRef}
          className={dialogStyles["context-dialog"]}
          onClose={() => setDialog(null)}
        >
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
              className={dialogStyles["edit-remove-button"]}
              onClick={() => setDialog("remove")}
            >
              <TrashIcon />
              Close this tab
            </button>
            <hr className={dialogStyles["edit-dialog-divider"]} />
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
        <dialog
          ref={removeDialogRef}
          className={dialogStyles["context-dialog"]}
          onClose={() => setDialog(null)}
        >
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
                className={dialogStyles["context-dialog__danger"]}
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
