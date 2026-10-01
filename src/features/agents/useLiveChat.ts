import { useEffect, useState } from "react";
import { type Snapshot } from "../../../packages/pi-live-chat/protocol";
import { readBrowserFrame } from "../../../packages/pi-live-chat/browserStream";

export function useLiveChat(target: string, enabled: boolean, session: string | undefined) {
  const [state, setState] = useState<{
    target: string;
    session?: string;
    snapshot?: Snapshot;
    error?: string;
  }>({ target, session });
  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let connected = false;
    let generation = 0;
    let events: EventSource | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let retryDelay = 1000;
    let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
    let deadline: number | undefined;
    let deadlineExpired = false;
    let startupReason = "Pi live chat did not become ready. Check Pi or switch to Terminal.";
    let recoveryRequested = false;
    let lastRecovery = -Infinity;
    let wasHidden = typeof document !== "undefined" && document.visibilityState !== "visible";

    function connectionError(reason: string) {
      if (disposed) return;
      setState((current) => ({
        target,
        session,
        ...(current.target === target && current.session === session
          ? { snapshot: current.snapshot }
          : {}),
        error: reason,
      }));
    }
    function checkDeadline() {
      if (deadline === undefined || deadlineExpired || Date.now() < deadline) return;
      deadlineExpired = true;
      connectionError(
        connected
          ? "Pi is taking too long to reconnect. Check your connection or switch to Terminal."
          : `Pi is taking too long to connect. ${startupReason}`,
      );
    }
    function startDeadline() {
      if (deadline !== undefined) return;
      deadline = Date.now() + 30_000;
      deadlineTimer = setTimeout(checkDeadline, 30_000);
    }
    function clearDeadline() {
      clearTimeout(deadlineTimer);
      deadlineTimer = undefined;
      deadline = undefined;
      deadlineExpired = false;
    }
    function waitForStartup(reason: string) {
      startupReason = reason;
      startDeadline();
      if (connected)
        connectionError(
          deadlineExpired
            ? "Pi is taking too long to reconnect. Check your connection or switch to Terminal."
            : "Reconnecting to Pi…",
        );
      else if (deadlineExpired) connectionError(reason);
      else {
        setState((current) =>
          current.target === target && current.session === session && current.snapshot
            ? { target, session, snapshot: current.snapshot, error: "Reconnecting to Pi…" }
            : { target, session },
        );
      }
      checkDeadline();
    }
    function retire() {
      generation++;
      events?.close();
      events = undefined;
    }
    function scheduleRetry() {
      retire();
      if (retry !== undefined || disposed) return;
      const delay = Math.min(30_000, retryDelay + Math.floor(Math.random() * 250));
      retryDelay = Math.min(30_000, retryDelay * 2);
      retry = setTimeout(() => {
        retry = undefined;
        connect();
      }, delay);
    }
    function connect() {
      if (disposed) return;
      clearTimeout(retry);
      retry = undefined;
      retire();
      startDeadline();
      // Rendered history is retained, but a new stream always needs its own full baseline.
      waitForStartup(startupReason);
      let previous: Snapshot | undefined;
      const currentGeneration = generation;
      const source = new EventSource(`/api/agents/${encodeURIComponent(target)}/chat`);
      events = source;
      const isCurrent = () => !disposed && currentGeneration === generation;
      source.onmessage = (event) => {
        if (!isCurrent()) return;
        try {
          const value: unknown = JSON.parse(event.data);
          if (
            typeof value === "object" &&
            value &&
            "type" in value &&
            (value.type === "unavailable" || value.type === "connecting")
          ) {
            const reason =
              "reason" in value && typeof value.reason === "string"
                ? value.reason
                : "Live chat unavailable";
            previous = undefined;
            if (value.type === "connecting") waitForStartup(reason);
            else {
              recoveryRequested = false;
              clearDeadline();
              setState({ target, session, error: reason });
            }
            return;
          }
          const snapshot = readBrowserFrame(previous, value);
          if (previous?.epoch === snapshot.epoch && previous.seq > snapshot.seq) return;
          previous = snapshot;
          connected = true;
          recoveryRequested = false;
          retryDelay = 1000;
          clearDeadline();
          setState({ target, session, snapshot });
        } catch {
          waitForStartup("Could not read Pi live chat. Check Pi or switch to Terminal.");
          scheduleRetry();
        }
      };
      source.onerror = () => {
        if (!isCurrent()) return;
        previous = undefined;
        waitForStartup("Could not connect to Pi live chat. Check Pi or switch to Terminal.");
        // CONNECTING is retried natively. CLOSED is terminal and needs a new instance.
        if (source.readyState === 2) scheduleRetry();
      };
    }
    function recover() {
      if (disposed || (typeof document !== "undefined" && document.visibilityState !== "visible"))
        return;
      checkDeadline();
      if (recoveryRequested && !deadlineExpired) return;
      recoveryRequested = true;
      waitForStartup(startupReason);
      retire();
      // Coalesce browser lifecycle bursts and rate-limit rapid hide/show cycles.
      if (retry !== undefined) return;
      const delay = Math.max(0, lastRecovery + 1000 - Date.now());
      const resume = () => {
        retry = undefined;
        lastRecovery = Date.now();
        connect();
      };
      if (delay) retry = setTimeout(resume, delay);
      else resume();
    }
    function visibilityChanged() {
      if (document.visibilityState !== "visible") wasHidden = true;
      else if (wasHidden) {
        wasHidden = false;
        recover();
      }
    }
    function pageShown(event: PageTransitionEvent) {
      if (event.persisted) recover();
    }
    connect();
    if (typeof document !== "undefined")
      document.addEventListener("visibilitychange", visibilityChanged);
    if (typeof window !== "undefined") {
      window.addEventListener("online", recover);
      window.addEventListener("pageshow", pageShown);
    }
    return () => {
      disposed = true;
      clearDeadline();
      clearTimeout(retry);
      retire();
      if (typeof document !== "undefined")
        document.removeEventListener("visibilitychange", visibilityChanged);
      if (typeof window !== "undefined") {
        window.removeEventListener("online", recover);
        window.removeEventListener("pageshow", pageShown);
      }
    };
  }, [target, enabled, session]);
  return enabled && state.target === target && state.session === session
    ? state
    : { target, session };
}
