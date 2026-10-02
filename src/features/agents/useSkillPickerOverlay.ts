import { useLayoutEffect, useRef, useSyncExternalStore } from "react";

const phoneQuery = "(width < 48rem)";
function isPhone() {
  return typeof window !== "undefined" && Boolean(window.matchMedia?.(phoneQuery).matches);
}
function subscribe(onChange: () => void) {
  const media = typeof window === "undefined" ? undefined : window.matchMedia?.(phoneQuery);
  media?.addEventListener("change", onChange);
  return () => media?.removeEventListener("change", onChange);
}

export function useSkillPickerOverlay(open: boolean) {
  const mobile = useSyncExternalStore(subscribe, isPhone, () => false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !mobile || !dialog) return;
    const viewport = window.visualViewport;
    const fit = () => {
      // dvh alone can include the keyboard on browsers that resize only their
      // visual viewport. Also follow panning when the browser reveals an input.
      dialog.style.setProperty("--skills-top", `${viewport?.offsetTop ?? 0}px`);
      dialog.style.setProperty("--skills-left", `${viewport?.offsetLeft ?? 0}px`);
      dialog.style.setProperty("--skills-height", `${viewport?.height ?? window.innerHeight}px`);
      dialog.style.setProperty("--skills-width", `${viewport?.width ?? window.innerWidth}px`);
    };
    fit();
    viewport?.addEventListener("resize", fit);
    viewport?.addEventListener("scroll", fit);
    window.addEventListener("resize", fit);
    if (!dialog.open) dialog.showModal();
    dialog.querySelector<HTMLInputElement>("input")?.focus({ preventScroll: true });
    return () => {
      viewport?.removeEventListener("resize", fit);
      viewport?.removeEventListener("scroll", fit);
      window.removeEventListener("resize", fit);
      if (dialog.open) dialog.close();
    };
  }, [open, mobile]);
  return { mobile, dialogRef };
}
