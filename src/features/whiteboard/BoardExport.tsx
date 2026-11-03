import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { BoardScene } from "../../../packages/pi-live-chat/boardProtocol";
import type { BoardImageQuality } from "../../../packages/pi-live-chat/boardImageExport";
import { downloadBlob, downloadScene } from "./scene";
import styles from "./BoardExport.module.css";

export function BoardExport({
  scene: currentScene,
  renderPng,
  onClose,
  onInteraction,
}: {
  scene: BoardScene;
  renderPng: (scene: BoardScene, quality: BoardImageQuality, signal: AbortSignal) => Promise<Blob>;
  onClose: () => void;
  onInteraction: (active: boolean) => void;
}) {
  const [scene] = useState(() => structuredClone(currentScene));
  const [quality, setQuality] = useState<BoardImageQuality>("standard");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const request = useRef<AbortController | null>(null);
  useLayoutEffect(() => {
    onInteraction(true);
    return () => onInteraction(false);
  }, [onInteraction]);
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => {
      request.current?.abort();
      element.close();
    };
  }, []);
  async function png() {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError("");
    try {
      const blob = await renderPng(scene, quality, controller.signal);
      if (!controller.signal.aborted)
        downloadBlob(blob, quality === "high" ? "whiteboard-high.png" : "whiteboard.png");
    } catch (reason) {
      if (!controller.signal.aborted)
        setError(reason instanceof Error ? reason.message : "Could not export PNG");
    } finally {
      if (!controller.signal.aborted) {
        request.current = null;
        setBusy(false);
      }
    }
  }
  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      data-ui="board-export"
      aria-labelledby="board-export-title"
      onKeyDown={(e) => {
        if (e.key === "Escape") e.stopPropagation();
      }}
      onCancel={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }}
    >
      <h2 id="board-export-title">Export board</h2>
      <p>
        Export the whole current drawing, including unsaved changes. Downloads do not change the
        board.
      </p>
      <section className={styles.section} aria-label="Editable JSON backup">
        <h3>JSON — editable backup</h3>
        <p>Keeps components, drawing data and images. PNG does not preserve editability.</p>
        <button
          type="button"
          onClick={() => {
            try {
              downloadScene(scene);
              setError("");
            } catch (reason) {
              setError(reason instanceof Error ? reason.message : "Could not export JSON");
            }
          }}
        >
          Download JSON
        </button>
      </section>
      <section className={styles.section} aria-label="PNG image export" aria-busy={busy}>
        <h3>PNG — image</h3>
        <label>
          Image resolution
          <select
            aria-label="Image resolution"
            value={quality}
            disabled={busy}
            onChange={(e) => setQuality(e.target.value as BoardImageQuality)}
          >
            <option value="standard">Standard — up to 2048 px</option>
            <option value="high">High — up to 4096 px</option>
          </select>
        </label>
        <p>
          High uses up to twice the pixel dimensions. Very large drawings may be scaled down to fit.
        </p>
        <button type="button" disabled={busy} onClick={() => void png()}>
          {busy ? "Rendering PNG…" : "Download PNG"}
        </button>
      </section>
      {error && <p role="alert">{error} Your drawing is unchanged. JSON remains available.</p>}
      <footer>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </footer>
    </dialog>
  );
}
