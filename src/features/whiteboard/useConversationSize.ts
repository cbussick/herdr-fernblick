import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
} from "react";
import { flushSync } from "react-dom";

const widthKey = "fernblick:whiteboard-conversation-width";
const desktopQuery = "(width >= 64rem) and (orientation: landscape)";
const snaps = [0.25, 0.5, 1];
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function savedWidth() {
  try {
    const value = Number(localStorage.getItem(widthKey));
    return Number.isFinite(value) && value >= 320 && value <= 10000 ? value : null;
  } catch {
    return null;
  }
}
function persistWidth(width: number) {
  try {
    localStorage.setItem(widthKey, String(Math.round(width)));
  } catch {
    // Resizing still works when storage is unavailable.
  }
}

/** Owns panel geometry only; never remounts the canvas or conversation. */
export function useConversationSize(dock: RefObject<HTMLElement | null>) {
  const [viewport, setViewport] = useState({ width: 0, height: 0, desktop: false });
  const [width, setWidth] = useState(savedWidth);
  const [fraction, setFraction] = useState(0.25);
  const [wide, setWide] = useState(false);
  const [dragging, setDragging] = useState(false);
  const dragFrame = useRef(0);
  useEffect(
    () => () => {
      if (dragFrame.current) cancelAnimationFrame(dragFrame.current);
    },
    [],
  );
  const gesture = useRef<{
    id: number;
    desktop: boolean;
    coordinate: number;
    size: number;
    width: number | null;
    fraction: number;
    wide: boolean;
  } | null>(null);

  useEffect(() => {
    const workspace = dock.current?.parentElement;
    if (!workspace) return;
    const media = window.matchMedia(desktopQuery);
    const measure = () => {
      const box = workspace.getBoundingClientRect();
      setViewport((previous) =>
        previous.width === box.width &&
        previous.height === box.height &&
        previous.desktop === media.matches
          ? previous
          : { width: box.width, height: box.height, desktop: media.matches },
      );
    };
    measure();
    let frame = 0;
    // Updating React during observer delivery can resize the canvas's own
    // observed descendants in the same cycle (notably in WebKit).
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    });
    observer.observe(workspace);
    media.addEventListener("change", measure);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      media.removeEventListener("change", measure);
    };
  }, [dock]);

  const desktop = viewport.desktop;
  const maxWidth = Math.max(320, Math.min(viewport.width - 320, viewport.width * 0.65));
  const actualWidth = clamp(
    wide ? viewport.width / 2 : (width ?? clamp(viewport.width * 0.34, 320, 448)),
    320,
    maxWidth,
  );
  const minFraction = Math.min(1, 176 / (viewport.height || 704));
  const actualFraction = clamp(fraction, minFraction, 1);
  const expanded = desktop ? wide : fraction === 1;

  function cancel() {
    const start = gesture.current;
    if (!start) return;
    gesture.current = null;
    cancelAnimationFrame(dragFrame.current);
    setWidth(start.width);
    setFraction(start.fraction);
    setWide(start.wide);
    setDragging(false);
  }
  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!event.isPrimary || event.button !== 0 || gesture.current) return;
    event.preventDefault();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = {
      id: event.pointerId,
      desktop,
      coordinate: desktop ? event.clientX : event.clientY,
      size: desktop ? actualWidth : actualFraction * viewport.height,
      width,
      fraction,
      wide,
    };
    setDragging(true);
  }
  function resize(event: PointerEvent<HTMLDivElement>, finish: boolean) {
    const start = gesture.current;
    if (!start || start.id !== event.pointerId) return;
    if (start.desktop !== desktop) {
      cancel();
      return;
    }
    const coordinate = desktop ? event.clientX : event.clientY;
    const size = start.size + start.coordinate - coordinate;
    cancelAnimationFrame(dragFrame.current);
    if (!finish) {
      // Coalesce pointer samples before layout; React Flow also observes the
      // canvas, so repeatedly resizing it within one frame causes WebKit loops.
      dragFrame.current = requestAnimationFrame(() => {
        dragFrame.current = 0;
        // Commit before observer delivery, not in a later concurrent render.
        flushSync(() => {
          if (desktop) {
            setWide(false);
            setWidth(clamp(size, 320, maxWidth));
          } else {
            setFraction(clamp(size / (viewport.height || 1), minFraction, 1));
          }
        });
      });
      return;
    }
    if (desktop) {
      const next = clamp(size, 320, maxWidth);
      setWide(false);
      setWidth(next);
      persistWidth(next);
    } else {
      const next = clamp(size / (viewport.height || 1), minFraction, 1);
      setFraction(
        snaps.reduce((best, snap) => (Math.abs(snap - next) < Math.abs(best - next) ? snap : best)),
      );
    }
    gesture.current = null;
    setDragging(false);
  }
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Escape" && gesture.current) {
      event.preventDefault();
      event.stopPropagation();
      cancel();
      return;
    }
    const grow = desktop ? "ArrowLeft" : "ArrowUp";
    const shrink = desktop ? "ArrowRight" : "ArrowDown";
    if (![grow, shrink, "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    if (desktop) {
      const next =
        event.key === "Home"
          ? 320
          : event.key === "End"
            ? maxWidth
            : clamp(
                actualWidth + (event.key === grow ? 1 : -1) * (event.shiftKey ? 64 : 16),
                320,
                maxWidth,
              );
      setWide(false);
      setWidth(next);
      persistWidth(next);
    } else {
      const next =
        event.key === "Home"
          ? snaps[0]
          : event.key === "End"
            ? 1
            : event.key === grow
              ? (snaps.find((snap) => snap > fraction + 0.01) ?? 1)
              : (snaps.findLast((snap) => snap < fraction - 0.01) ?? snaps[0]);
      setFraction(next);
    }
  }
  return {
    expanded,
    dragging,
    toggle: () => (desktop ? setWide(!wide) : setFraction(expanded ? 0.25 : 1)),
    collapse: () => {
      setWide(false);
      setFraction(0.25);
    },
    style: {
      "--conversation-width": viewport.width ? `${actualWidth}px` : undefined,
      "--conversation-height": `${actualFraction * 100}%`,
    } as CSSProperties,
    separator: {
      role: "separator" as const,
      tabIndex: 0,
      "aria-label": desktop ? "Resize conversation width" : "Resize conversation height",
      "aria-orientation": desktop ? ("vertical" as const) : ("horizontal" as const),
      "aria-controls": "whiteboard-conversation-panel",
      "aria-valuemin": desktop ? 320 : Math.round(minFraction * 100),
      "aria-valuemax": desktop ? Math.round(maxWidth) : 100,
      "aria-valuenow": Math.round(desktop ? actualWidth : actualFraction * 100),
      "aria-valuetext": desktop
        ? `${Math.round(actualWidth)} pixels wide`
        : `${Math.round(actualFraction * 100)} percent of workspace height`,
      onPointerDown,
      onPointerMove: (event: PointerEvent<HTMLDivElement>) => resize(event, false),
      onPointerUp: (event: PointerEvent<HTMLDivElement>) => resize(event, true),
      onPointerCancel: (event: PointerEvent<HTMLDivElement>) => {
        if (gesture.current?.id === event.pointerId) cancel();
      },
      onLostPointerCapture: (event: PointerEvent<HTMLDivElement>) => {
        if (gesture.current?.id === event.pointerId) cancel();
      },
      onKeyDown,
    },
  };
}
