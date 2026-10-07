import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from "react";
import { MoreIcon } from "../../shared/ui/Icons";
import styles from "./ConversationActionsMenu.module.css";

export interface ConversationAction {
  id: string;
  label: string;
  description?: string;
  disabledReason?: string;
  onSelect: () => void;
}

interface Props {
  actions: readonly ConversationAction[];
  contextKey: string;
  disabled?: boolean;
  triggerRef: RefObject<HTMLButtonElement | null>;
  children: (trigger: ReactNode) => ReactNode;
}

// A small overflow menu, not a Pi command catalogue. Native popover gives it
// top-layer placement and light dismissal despite the composer's clipped surface.
export function ConversationActionsMenu({
  actions,
  contextKey,
  disabled = false,
  triggerRef,
  children,
}: Props) {
  const [open, setOpen] = useState(false);
  const [previousContext, setPreviousContext] = useState(contextKey);
  const [active, setActive] = useState(0);
  const menuId = useId();
  const menu = useRef<HTMLDivElement>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);
  const openingIndex = useRef(0);
  if (previousContext !== contextKey) {
    setPreviousContext(contextKey);
    setOpen(false);
  }
  if (open && disabled) setOpen(false);
  function close(restoreFocus = true) {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }
  function show(index = 0) {
    if (disabled) return;
    openingIndex.current = index;
    setActive(index);
    setOpen(true);
  }
  useEffect(() => {
    const popup = menu.current;
    const anchor = triggerRef.current;
    if (!open || !popup || !anchor) return;
    popup.showPopover();
    function position() {
      const viewport = window.visualViewport;
      const minX = (viewport?.offsetLeft ?? 0) + 8;
      const minY = (viewport?.offsetTop ?? 0) + 8;
      const maxX = minX + (viewport?.width ?? window.innerWidth) - 16;
      const maxY = minY + (viewport?.height ?? window.innerHeight) - 16;
      const rect = anchor!.getBoundingClientRect();
      const width = Math.min(272, maxX - minX);
      popup!.style.setProperty("--menu-width", `${width}px`);
      popup!.style.setProperty("--menu-max-height", `${maxY - minY}px`);
      const height = popup!.getBoundingClientRect().height;
      const above = rect.top - minY - 8;
      const below = maxY - rect.bottom - 8;
      const placeAbove = above >= height || above >= below;
      popup!.style.setProperty(
        "--menu-max-height",
        `${Math.max(44, placeAbove ? above : below)}px`,
      );
      const visibleHeight = popup!.getBoundingClientRect().height;
      const top = placeAbove ? rect.top - visibleHeight - 8 : rect.bottom + 8;
      popup!.style.setProperty(
        "--menu-top",
        `${Math.max(minY, Math.min(top, maxY - visibleHeight))}px`,
      );
      popup!.style.setProperty(
        "--menu-left",
        `${Math.max(minX, Math.min(rect.right - width, maxX - width))}px`,
      );
    }
    position();
    items.current[openingIndex.current]?.focus({ preventScroll: true });
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    window.visualViewport?.addEventListener("resize", position);
    window.visualViewport?.addEventListener("scroll", position);
    const observer = new ResizeObserver(position);
    observer.observe(anchor);
    observer.observe(popup);
    return () => {
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
      window.visualViewport?.removeEventListener("resize", position);
      window.visualViewport?.removeEventListener("scroll", position);
      observer.disconnect();
      if (popup.matches(":popover-open")) popup.hidePopover();
    };
  }, [open, triggerRef]);

  const trigger = (
    <button
      type="button"
      ref={triggerRef}
      className={styles.trigger}
      data-ui="conversation-actions-button"
      disabled={disabled}
      aria-label="More conversation actions"
      title="More conversation actions"
      aria-haspopup="menu"
      aria-expanded={open}
      aria-controls={open ? menuId : undefined}
      onClick={() => (open ? close() : show())}
      onKeyDown={(event) => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          const index = event.key === "ArrowUp" ? Math.max(0, actions.length - 1) : 0;
          if (open) items.current[index]?.focus();
          else show(index);
        }
      }}
    >
      <MoreIcon />
    </button>
  );
  return (
    <>
      {children(trigger)}
      {open ? (
        <div
          ref={menu}
          id={menuId}
          className={styles.menu}
          popover="auto"
          role="menu"
          aria-label="Conversation actions"
          onToggle={(event) => {
            if (event.newState === "closed") close(false);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              close();
            } else if (event.key === "Tab") {
              // Restore the toolbar origin before the browser performs normal Tab.
              close();
            } else if (
              actions.length &&
              ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)
            ) {
              event.preventDefault();
              const index =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? actions.length - 1
                    : (active + (event.key === "ArrowDown" ? 1 : -1) + actions.length) %
                      actions.length;
              setActive(index);
              items.current[index]?.focus();
            }
          }}
        >
          {actions.map((action, index) => (
            <button
              key={action.id}
              ref={(element) => {
                items.current[index] = element;
              }}
              type="button"
              role="menuitem"
              className={styles.item}
              aria-label={action.label}
              aria-disabled={Boolean(action.disabledReason)}
              aria-describedby={
                action.disabledReason || action.description
                  ? `${menuId}-${action.id}-description`
                  : undefined
              }
              tabIndex={index === active ? 0 : -1}
              onFocus={() => setActive(index)}
              onClick={() => {
                if (action.disabledReason) return;
                close(false);
                action.onSelect();
              }}
            >
              <span>{action.label}</span>
              {action.disabledReason || action.description ? (
                <small id={`${menuId}-${action.id}-description`}>
                  {action.disabledReason ?? action.description}
                </small>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </>
  );
}
