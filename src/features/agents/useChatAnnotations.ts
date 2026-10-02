import { useEffect, useEffectEvent, useRef, useState, type RefObject } from "react";
import {
  MAX_TEXT,
  matchesTarget,
  targetOf,
  type Snapshot,
  type Target,
} from "../../../packages/pi-live-chat/protocol";
import {
  annotationPrompt,
  readAnnotationSelection,
  type Annotation,
  type AnnotationSource,
} from "./annotations";

export type AnnotationEditor = {
  source: AnnotationSource;
  target: Target;
  id?: string;
  comment: string;
  anchor: () => DOMRect;
  autoFocus: boolean;
};

export function useChatAnnotations(
  snapshot: Snapshot | undefined,
  visible: boolean,
  transcript: RefObject<HTMLElement | null>,
  sending: boolean,
) {
  const [enabled, setEnabled] = useState(false);
  const [entries, setEntries] = useState<Annotation[]>([]);
  const [owner, setOwner] = useState<Target | null>(null);
  const [editor, setEditor] = useState<AnnotationEditor | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const nextId = useRef(0);
  const stale = Boolean(owner && entries.length && snapshot && !matchesTarget(snapshot, owner));
  const editorStale = Boolean(editor && (!snapshot || !matchesTarget(snapshot, editor.target)));

  function begin(source: AnnotationSource, anchor: () => DOMRect, autoFocus = true) {
    if (!snapshot || stale || sending || editor?.comment.trim()) return;
    setEditor({ source, target: targetOf(snapshot), comment: "", anchor, autoFocus });
    setError("");
    setNotice("");
  }

  const available = Boolean(snapshot);
  const capture = useEffectEvent((autoFocus: boolean) => {
    if (
      !snapshot ||
      !transcript.current ||
      document.activeElement?.closest('[data-ui="annotation-popover"]')
    )
      return;
    const selected = readAnnotationSelection(
      window.getSelection(),
      transcript.current,
      snapshot.messages,
    );
    if (selected) begin(selected.source, () => selected.range.getBoundingClientRect(), autoFocus);
  });
  useEffect(() => {
    if (!enabled || !visible || !available || stale || sending) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let touch = false;
    function down(event: PointerEvent) {
      touch = event.pointerType === "touch";
    }
    function up() {
      if (!touch) capture(true);
    }
    function keyboard(event: KeyboardEvent) {
      if (event.key === "Shift" || event.key.startsWith("Arrow")) capture(true);
    }
    function selectionChanged() {
      clearTimeout(timer);
      // Touch selection handles settle after pointerup; do not steal focus or
      // open the software keyboard until the user taps the comment field.
      timer = setTimeout(() => {
        if (touch) capture(false);
      }, 450);
    }
    document.addEventListener("pointerdown", down);
    document.addEventListener("pointerup", up);
    document.addEventListener("pointercancel", up);
    document.addEventListener("keyup", keyboard);
    document.addEventListener("selectionchange", selectionChanged);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("pointerdown", down);
      document.removeEventListener("pointerup", up);
      document.removeEventListener("pointercancel", up);
      document.removeEventListener("keyup", keyboard);
      document.removeEventListener("selectionchange", selectionChanged);
    };
  }, [enabled, visible, available, stale, sending]);

  function close() {
    setEditor(null);
    setError("");
    window.getSelection()?.removeAllRanges();
    transcript.current?.focus({ preventScroll: true });
  }
  function save() {
    if (!editor || !editor.comment.trim() || editorStale || stale || sending) return;
    const entry: Annotation = {
      ...editor.source,
      id: editor.id ?? `annotation-${++nextId.current}`,
      comment: editor.comment.trim(),
    };
    const updated = editor.id
      ? entries.map((value) => (value.id === editor.id ? entry : value))
      : [...entries, entry];
    if (annotationPrompt(updated).length > MAX_TEXT) {
      setError(
        "Comments exceed the 32,000-character message limit. Shorten this comment or select a smaller passage.",
      );
      return;
    }
    setEntries(updated);
    setOwner(editor.target);
    setNotice(editor.id ? "Comment updated." : "Comment added. Not sent yet.");
    close();
  }
  function edit(entry: Annotation, anchor: () => DOMRect) {
    if (!owner || sending) return;
    setEditor({
      source: entry,
      target: owner,
      id: entry.id,
      comment: entry.comment,
      anchor,
      autoFocus: true,
    });
    setError("");
  }
  function remove(id: string) {
    if (sending) return;
    setEntries((current) => current.filter((entry) => entry.id !== id));
    if (editor?.id === id) close();
  }
  function acknowledge(ids: string[]) {
    setEntries((current) => current.filter((entry) => !ids.includes(entry.id)));
    setNotice("Comments forwarded to Pi.");
  }
  return {
    enabled,
    setEnabled,
    entries,
    owner,
    stale,
    editor,
    editorStale,
    error,
    notice,
    begin,
    close,
    save,
    edit,
    remove,
    acknowledge,
    setComment: (comment: string) =>
      setEditor((current) => (current ? { ...current, comment } : null)),
    clear: () => {
      setEntries([]);
      setEditor(null);
      setOwner(null);
      setError("");
    },
  };
}

export type ChatAnnotations = ReturnType<typeof useChatAnnotations>;
