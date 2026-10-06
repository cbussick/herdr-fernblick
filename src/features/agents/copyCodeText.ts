import styles from "./ChatMessageText.module.css";

// Fernblick can run on an HTTP tailnet address, where Clipboard API is absent.
export async function copyCodeText(value: string) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return;
    }
  } catch {
    // Try the user-activated legacy path before reporting failure.
  }
  const selection = window.getSelection();
  const ranges = selection
    ? Array.from({ length: selection.rangeCount }, (_, index) =>
        selection.getRangeAt(index).cloneRange(),
      )
    : [];
  const focused = document.activeElement;
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.className = styles.clipboard;
  textarea.setAttribute("aria-label", "Code to copy");
  document.body.append(textarea);
  try {
    textarea.select();
    if (!document.execCommand("copy")) throw new Error("Clipboard unavailable");
  } finally {
    textarea.remove();
    if (focused instanceof HTMLElement) focused.focus({ preventScroll: true });
    selection?.removeAllRanges();
    for (const range of ranges) selection?.addRange(range);
  }
}
