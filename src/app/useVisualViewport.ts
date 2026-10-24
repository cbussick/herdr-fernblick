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
    const fit = () => {
      // Pinch zoom must magnify the existing layout, not cause it to reflow.
      if (Math.abs(viewport.scale - 1) > 0.01 || viewport.width <= 0 || viewport.height <= 0)
        return;
      const values = [viewport.offsetTop, viewport.offsetLeft, viewport.width, viewport.height];
      properties.forEach((property, index) =>
        element.style.setProperty(property, `${values[index]}px`),
      );
    };
    fit();
    viewport.addEventListener("resize", fit);
    viewport.addEventListener("scroll", fit);
    window.addEventListener("resize", fit);
    return () => {
      viewport.removeEventListener("resize", fit);
      viewport.removeEventListener("scroll", fit);
      window.removeEventListener("resize", fit);
      properties.forEach((property) => element.style.removeProperty(property));
    };
  }, []);
  return ref;
}
