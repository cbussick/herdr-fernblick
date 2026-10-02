import { useSyncExternalStore } from "react";

function singlePaneLayout() {
  if (window.matchMedia("(width < 48rem)").matches) return true;
  if (window.matchMedia("(width >= 75rem)").matches) return false;

  // The software keyboard can turn the *viewport* landscape without rotating
  // the tablet. Physical screen dimensions do not shrink with the keyboard.
  // Keep viewport-based behavior for desktop windows and tablet split views.
  const touchDevice =
    navigator.maxTouchPoints > 0 || window.matchMedia("(any-pointer: coarse)").matches;
  const portraitScreen = touchDevice && window.screen.height > window.screen.width;
  return portraitScreen || window.matchMedia("(orientation: portrait)").matches;
}

function subscribe(onChange: () => void) {
  window.addEventListener("resize", onChange);
  window.addEventListener("orientationchange", onChange);
  const orientation = window.screen.orientation;
  orientation?.addEventListener("change", onChange);
  return () => {
    window.removeEventListener("resize", onChange);
    window.removeEventListener("orientationchange", onChange);
    orientation?.removeEventListener("change", onChange);
  };
}

export function useSinglePaneLayout() {
  return useSyncExternalStore(subscribe, singlePaneLayout, () => true);
}
