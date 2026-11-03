import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { BoardScene } from "../../../packages/pi-live-chat/boardProtocol";
import type { BoardImageQuality } from "../../../packages/pi-live-chat/boardImageExport";
import { downloadBlob, downloadScene } from "./scene";
import styles from "./BoardExport.module.css";

/** A compact action menu attached to the editor's existing Download control. */
export function BoardExport({
  scene: currentScene,
  anchor,
  renderPng,
  onClose,
  onInteraction,
}: {
  scene: BoardScene;
  anchor: HTMLElement;
  renderPng: (scene: BoardScene, quality: BoardImageQuality, signal: AbortSignal) => Promise<Blob>;
  onClose: () => void;
  onInteraction: (active: boolean) => void;
}) {
  const [scene] = useState(() => structuredClone(currentScene));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const menu = useRef<HTMLDialogElement>(null);
  const request = useRef<AbortController | null>(null);
  useLayoutEffect(() => {
    const element = menu.current!;
    const position = () => {
      const target = anchor.getBoundingClientRect();
      const box = element.getBoundingClientRect();
      const width = document.documentElement.clientWidth;
      const height = window.innerHeight;
      element.style.left = `${Math.max(8, Math.min(target.right - box.width, width - box.width - 8))}px`;
      element.style.top = `${Math.max(8, target.bottom + 6 + box.height <= height - 8 ? target.bottom + 6 : target.top - box.height - 6)}px`;
    };
    position();
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    return () => {
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
    };
  }, [anchor, busy, error]);
  useLayoutEffect(() => {
    onInteraction(true);
    const frame = requestAnimationFrame(() =>
      menu.current?.querySelector<HTMLButtonElement>("button")?.focus(),
    );
    return () => {
      cancelAnimationFrame(frame);
      request.current?.abort();
      onInteraction(false);
      if (anchor.isConnected) anchor.focus({ preventScroll: true });
    };
  }, [anchor, onInteraction]);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !menu.current?.contains(event.target) &&
        !anchor.contains(event.target)
      ) {
        // Dismiss before this pointer can start a canvas drag.
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("pointerdown", outside, true);
    return () => document.removeEventListener("pointerdown", outside, true);
  }, [anchor, onClose]);
  async function png(quality: BoardImageQuality) {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError("");
    try {
      const blob = await renderPng(scene, quality, controller.signal);
      if (!controller.signal.aborted) {
        downloadBlob(blob, quality === "high" ? "whiteboard-high.png" : "whiteboard.png");
        onClose();
      }
    } catch (reason) {
      if (!controller.signal.aborted)
        setError(reason instanceof Error ? reason.message : "Could not download PNG");
    } finally {
      if (!controller.signal.aborted) {
        request.current = null;
        setBusy(false);
      }
    }
  }
  return (
    <dialog
      open
      ref={menu}
      id="board-download-menu"
      role="menu"
      aria-label="Download board"
      aria-busy={busy}
      className={styles.menu}
      data-ui="board-export"
      onKeyDown={(event) => {
        const keys = ["Escape", "Tab", "ArrowDown", "ArrowUp", "Home", "End"];
        if (!keys.includes(event.key)) return;
        event.preventDefault();
        event.stopPropagation();
        if (event.key === "Escape" || event.key === "Tab") {
          onClose();
          return;
        }
        const items = Array.from(
          menu.current!.querySelectorAll<HTMLButtonElement>(
            'button[role="menuitem"]:not(:disabled)',
          ),
        );
        const current = items.indexOf(document.activeElement as HTMLButtonElement);
        const index =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? items.length - 1
              : (current + (event.key === "ArrowUp" ? -1 : 1) + items.length) % items.length;
        items[index]?.focus();
      }}
    >
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          try {
            downloadScene(scene);
            onClose();
          } catch (reason) {
            setError(reason instanceof Error ? reason.message : "Could not download JSON");
          }
        }}
      >
        Download JSON <small aria-hidden="true">Editable</small>
      </button>
      <button type="button" role="menuitem" disabled={busy} onClick={() => void png("standard")}>
        Download PNG <small aria-hidden="true">≤2048 px</small>
      </button>
      <button type="button" role="menuitem" disabled={busy} onClick={() => void png("high")}>
        Download PNG (high resolution) <small aria-hidden="true">≤4096 px</small>
      </button>
      {busy && <p role="status">Rendering PNG…</p>}
      {error && <p role="alert">{error} Your drawing is unchanged.</p>}
    </dialog>
  );
}
