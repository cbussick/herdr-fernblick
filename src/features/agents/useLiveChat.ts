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
    let previous: Snapshot | undefined;
    let events: EventSource;
    let retry: ReturnType<typeof setTimeout> | undefined;
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
    function connect() {
      if (disposed) return;
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
            value.type === "unavailable"
          ) {
            const reason =
              "reason" in value && typeof value.reason === "string"
                ? value.reason
                : "Live chat unavailable";
            previous = undefined;
            setState({ target, session, error: reason });
            return;
          }
          const snapshot = readBrowserFrame(previous, value);
          if (previous?.epoch === snapshot.epoch && previous.seq > snapshot.seq) return;
          previous = snapshot;
          setState({ target, session, snapshot });
        } catch {
          events.close();
          connectionError("Reconnecting to Pi…");
          retry = setTimeout(connect, 1000);
        }
      };
      events.onerror = () => {
        previous = undefined;
        connectionError("Reconnecting to Pi…");
      };
    }
    connect();
    return () => {
      disposed = true;
      clearTimeout(retry);
      events.close();
    };
  }, [target, enabled, session]);
  return enabled && state.target === target && state.session === session
    ? state
    : { target, session };
}
