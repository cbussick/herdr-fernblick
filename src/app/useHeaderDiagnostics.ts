import { useLayoutEffect } from "react";

// Temporary iPad header investigation. Geometry only, held in memory until reload.
// Keep the last visible console even after navigating back to open Settings.
const latest: Record<string, unknown> = {};

function rectangle(element: Element) {
  const { x, y, width, height } = element.getBoundingClientRect();
  return { x, y, width, height };
}

function surface(element: Element) {
  const style = getComputedStyle(element);
  return {
    bounds: rectangle(element),
    paddingTop: style.paddingTop,
    position: style.position,
    background: style.backgroundColor,
    filter: style.filter,
    backdropFilter: style.backdropFilter,
    webkitBackdropFilter: style.getPropertyValue("-webkit-backdrop-filter"),
    transform: style.transform,
    overflow: style.overflow,
  };
}

function viewport() {
  const visual = window.visualViewport;
  return {
    layout: { width: window.innerWidth, height: window.innerHeight },
    visual: visual
      ? {
          width: visual.width,
          height: visual.height,
          offsetTop: visual.offsetTop,
          offsetLeft: visual.offsetLeft,
          pageTop: visual.pageTop,
          pageLeft: visual.pageLeft,
          scale: visual.scale,
        }
      : null,
    scroll: { x: window.scrollX, y: window.scrollY },
    screen: { width: window.screen.width, height: window.screen.height },
  };
}

function capture() {
  for (const kind of ["console", "overview"]) {
    const header = document.querySelector(`[data-testid="${kind}-header"]`);
    if (!header) continue;
    const bounds = header.getBoundingClientRect();
    // A mounted overview can be hidden behind the single-pane console.
    if (bounds.width <= 0 || bounds.height <= 0) continue;
    const ancestors = [];
    for (let node = header.parentElement; node && ancestors.length < 4; node = node.parentElement)
      ancestors.push(surface(node));
    latest[kind] = {
      capturedAt: new Date().toISOString(),
      viewport: viewport(),
      header: surface(header),
      // Fixed semantic roles only: never copy text, IDs, URLs, or input values.
      contextLine: header.querySelector("p") ? surface(header.querySelector("p")!) : null,
      title: header.querySelector("h2") ? surface(header.querySelector("h2")!) : null,
      ancestors,
    };
  }
}

export function getHeaderDiagnostics() {
  return { version: 1, ...latest };
}

export function useHeaderDiagnostics() {
  // Capture after each app navigation/render; no React state or storage writes.
  useLayoutEffect(() => {
    if (typeof document === "undefined") return;
    capture();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(capture);
    for (const node of document.querySelectorAll(
      '[data-testid="console-header"], [data-testid="overview-header"]',
    ))
      observer?.observe(node);
    window.addEventListener("resize", capture);
    window.addEventListener("scroll", capture);
    window.visualViewport?.addEventListener("resize", capture);
    window.visualViewport?.addEventListener("scroll", capture);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", capture);
      window.removeEventListener("scroll", capture);
      window.visualViewport?.removeEventListener("resize", capture);
      window.visualViewport?.removeEventListener("scroll", capture);
    };
  });
}
