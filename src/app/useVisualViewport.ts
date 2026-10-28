import { useLayoutEffect, useRef } from "react";

// The layout viewport can resize and then pan independently when iPadOS reveals
// a focused editor. Keep the app in the visible rectangle without scrolling the
// document, changing focus, or rerendering the composer during keyboard/IME input.
export function useVisualViewport() {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const viewport = window.visualViewport;
    if (!viewport) return;
    const properties = [
      "--app-viewport-top",
      "--app-viewport-left",
      "--app-viewport-width",
      "--app-viewport-height",
    ];
    let layoutWidth = window.innerWidth;
    let layoutHeight = window.innerHeight;
    const fit = () => {
      if (document.visibilityState === "hidden" || viewport.width <= 0 || viewport.height <= 0)
        return;
      const zoomed = Math.abs(viewport.scale - 1) > 0.01;
      const layoutChanged =
        window.innerWidth !== layoutWidth || window.innerHeight !== layoutHeight;
      // Preserve the keyboard/pan rectangle during intentional pinch zoom. But
      // Safari can restore a different layout size while still reporting zoom:
      // retaining the old pixel dimensions then leaves the app clipped/stunted.
      // Use unzoomed layout bounds in that case, never the smaller zoom rectangle.
      if (zoomed && !layoutChanged) return;
      if (zoomed && (window.innerWidth <= 0 || window.innerHeight <= 0)) return;
      const values = zoomed
        ? [0, 0, window.innerWidth, window.innerHeight]
        : [viewport.offsetTop, viewport.offsetLeft, viewport.width, viewport.height];
      layoutWidth = window.innerWidth;
      layoutHeight = window.innerHeight;
      properties.forEach((property, index) =>
        element.style.setProperty(property, `${values[index]}px`),
      );
    };
    fit();
    viewport.addEventListener("resize", fit);
    viewport.addEventListener("scroll", fit);
    window.addEventListener("resize", fit);
    window.addEventListener("pageshow", fit);
    document.addEventListener("visibilitychange", fit);
    return () => {
      viewport.removeEventListener("resize", fit);
      viewport.removeEventListener("scroll", fit);
      window.removeEventListener("resize", fit);
      window.removeEventListener("pageshow", fit);
      document.removeEventListener("visibilitychange", fit);
      properties.forEach((property) => element.style.removeProperty(property));
    };
  }, []);
  return ref;
}
