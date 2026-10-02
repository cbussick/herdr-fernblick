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

type AnnotationAnchor = {
  source: AnnotationSource;
  target: Target;
  anchor: () => DOMRect;
};
type AnnotationSelection = AnnotationAnchor & { touch: boolean };
export type AnnotationEditor = AnnotationAnchor & { id?: string; comment: string };

export function useChatAnnotations(
  snapshot: Snapshot | undefined,
  visible: boolean,
  transcript: RefObject<HTMLElement | null>,
  sending: boolean,
) {
  const [entries, setEntries] = useState<Annotation[]>([]);
  const [owner, setOwner] = useState<Target | null>(null);
  const [editor, setEditor] = useState<AnnotationEditor | null>(null);
  const [candidate, setCandidate] = useState<AnnotationSelection | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const nextId = useRef(0);
  const stale = Boolean(owner && entries.length && snapshot && !matchesTarget(snapshot, owner));
  const editorStale = Boolean(editor && (!snapshot || !matchesTarget(snapshot, editor.target)));
  const selection =
    visible &&
    !sending &&
    !stale &&
    !editor &&
    snapshot &&
    candidate &&
    matchesTarget(snapshot, candidate.target)
      ? candidate
      : null;

  function begin(source: AnnotationSource, anchor: () => DOMRect) {
    if (!snapshot || stale || sending || editor) return;
    setCandidate(null);
    setEditor({ source, target: targetOf(snapshot), comment: "", anchor });
    setError("");
    setNotice("");
  }
  function openSelection() {
    if (selection) begin(selection.source, selection.anchor);
  }

  const available = Boolean(snapshot);
  const capture = useEffectEvent((touch = false) => {
    if (!snapshot || !transcript.current || editor) return;
    const active = document.activeElement;
    if (active?.closest('[data-ui="annotation-action"], [data-ui="annotation-popover"]')) return;
    if (active?.matches('input, textarea, [contenteditable="true"]')) {
      setCandidate(null);
      return;
    }
    const selected = readAnnotationSelection(
      window.getSelection(),
      transcript.current,
      snapshot.messages,
    );
    setCandidate(
      selected
        ? {
            source: selected.source,
            target: targetOf(snapshot),
            // Native selection handles may emit selectionchange without a new
            // pointer event, including iPads with a trackpad attached.
            touch:
              touch ||
              navigator.maxTouchPoints > 0 ||
              window.matchMedia("(any-pointer: coarse)").matches,
            anchor: () => selected.range.getBoundingClientRect(),
          }
        : null,
    );
  });
  const shortcut = useEffectEvent((event: KeyboardEvent) => {
    if (!selection || event.isComposing) return;
    if (event.key === "Escape") {
      setCandidate(null);
      window.getSelection()?.removeAllRanges();
    } else if (event.key === "Enter" && event.altKey) {
      event.preventDefault();
      openSelection();
    } else if (
      event.key === "Tab" &&
      !event.shiftKey &&
      !document.activeElement?.closest('[data-ui="annotation-action"]')
    ) {
      // Make the contextual action reachable from a keyboard-selected passage
      // without moving focus merely because a selection exists.
      event.preventDefault();
      document
        .querySelector<HTMLButtonElement>('[data-ui="annotation-action"] button')
        ?.focus({ preventScroll: true });
    }
  });
  useEffect(() => {
    if (!visible || !available || stale || sending || typeof document === "undefined") return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let touch = false;
    let dragging = false;
    function inAnnotationUI(target: EventTarget | null) {
      return (
        target instanceof Element &&
        target.closest('[data-ui="annotation-action"], [data-ui="annotation-popover"]')
      );
    }
    function down(event: PointerEvent) {
      if (inAnnotationUI(event.target)) return;
      touch = event.pointerType === "touch";
      dragging = true;
      setCandidate(null);
    }
    function up(event: PointerEvent) {
      dragging = false;
      if (!touch && !inAnnotationUI(event.target)) capture();
    }
    function keyboard(event: KeyboardEvent) {
      if (event.key === "Shift" || event.key.startsWith("Arrow")) capture();
    }
    function selectionChanged() {
      clearTimeout(timer);
      // Let native touch selection handles settle. Revealing the action never
      // focuses it, opens the keyboard, clears the selection, or intercepts Copy.
      timer = setTimeout(
        () => {
          if (!dragging || touch) capture(touch);
        },
        touch ? 450 : 120,
      );
    }
    document.addEventListener("pointerdown", down);
    document.addEventListener("pointerup", up);
    document.addEventListener("pointercancel", up);
    document.addEventListener("keydown", shortcut);
    document.addEventListener("keyup", keyboard);
    document.addEventListener("selectionchange", selectionChanged);
    return () => {
      // Captured DOM ranges must not survive hiding/replacing the transcript.
      setCandidate(null);
      clearTimeout(timer);
      document.removeEventListener("pointerdown", down);
      document.removeEventListener("pointerup", up);
      document.removeEventListener("pointercancel", up);
      document.removeEventListener("keydown", shortcut);
      document.removeEventListener("keyup", keyboard);
      document.removeEventListener("selectionchange", selectionChanged);
    };
  }, [visible, available, stale, sending]);

  function close() {
    setEditor(null);
    setCandidate(null);
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
    if (!owner || sending || editor) return;
    setCandidate(null);
    setEditor({ source: entry, target: owner, id: entry.id, comment: entry.comment, anchor });
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
    entries,
    owner,
    stale,
    selection,
    editor,
    editorStale,
    error,
    notice,
    interacting: Boolean(selection || editor),
    begin,
    openSelection,
    close,
    save,
    edit,
    remove,
    acknowledge,
    setComment: (comment: string) =>
      setEditor((current) => (current ? { ...current, comment } : null)),
    clear: () => {
      if (sending) return;
      setEntries([]);
      setCandidate(null);
      setEditor(null);
      setOwner(null);
      setError("");
    },
  };
}

export type ChatAnnotations = ReturnType<typeof useChatAnnotations>;
