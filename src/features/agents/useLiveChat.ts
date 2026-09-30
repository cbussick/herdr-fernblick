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
    let startupExpired = false;
    let startupReason = "Pi live chat did not become ready. Check Pi or switch to Terminal.";
    let previous: Snapshot | undefined;
    let events: EventSource;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let startupTimer: ReturnType<typeof setTimeout> | undefined;
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
    function startDeadline() {
      if (startupTimer || connected || startupExpired) return;
      startupTimer = setTimeout(() => {
        startupExpired = true;
        connectionError(`Pi is taking too long to connect. ${startupReason}`);
      }, 30_000);
    }
    function waitForStartup(reason: string) {
      if (disposed) return;
      startupReason = reason;
      if (connected || startupExpired) {
        connectionError(reason);
        return;
      }
      startDeadline();
      setState((current) =>
        current.target === target && current.session === session && current.snapshot
          ? { target, session, snapshot: current.snapshot, error: "Reconnecting to Pi…" }
          : { target, session },
      );
    }
    function connect() {
      if (disposed) return;
      startDeadline();
      previous = undefined;
      events = new EventSource(`/api/agents/${encodeURIComponent(target)}/chat`);
      events.onmessage = (event) => {
        if (disposed) return;
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
              clearTimeout(startupTimer);
              startupExpired = true;
              setState({ target, session, error: reason });
            }
            return;
          }
          const snapshot = readBrowserFrame(previous, value);
          if (previous?.epoch === snapshot.epoch && previous.seq > snapshot.seq) return;
          previous = snapshot;
          connected = true;
          clearTimeout(startupTimer);
          setState({ target, session, snapshot });
        } catch {
          clearTimeout(startupTimer);
          startupExpired = true;
          events.close();
          connectionError("Reconnecting to Pi…");
          retry = setTimeout(connect, 1000);
        }
      };
      events.onerror = () => {
        if (disposed) return;
        previous = undefined;
        if (connected) connectionError("Reconnecting to Pi…");
        else waitForStartup("Could not connect to Pi live chat. Check Pi or switch to Terminal.");
      };
    }
    connect();
    return () => {
      disposed = true;
      clearTimeout(startupTimer);
      clearTimeout(retry);
      events.close();
    };
  }, [target, enabled, session]);
  return enabled && state.target === target && state.session === session
    ? state
    : { target, session };
}
