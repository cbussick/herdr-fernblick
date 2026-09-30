import { useEffect, useState } from "react";
import { snapshotSchema, type Snapshot } from "../../../packages/pi-live-chat/protocol";

export function useLiveChat(target: string, enabled: boolean, session: string | undefined) {
  const [state, setState] = useState<{
    target: string;
    session?: string;
    snapshot?: Snapshot;
    error?: string;
  }>({ target, session });
  useEffect(() => {
    if (!enabled) return;
    const events = new EventSource(`/api/agents/${encodeURIComponent(target)}/chat`);
    let previous: Snapshot | undefined;
    events.onmessage = (event) => {
      try {
        const value: unknown = JSON.parse(event.data);
        if (typeof value === "object" && value && "type" in value && value.type === "unavailable") {
          const reason =
            "reason" in value && typeof value.reason === "string"
              ? value.reason
              : "Live chat unavailable";
          previous = undefined;
          setState({ target, session, error: reason });
          return;
        }
        const snapshot = snapshotSchema.parse(value);
        if (previous?.epoch === snapshot.epoch && previous.seq >= snapshot.seq) return;
        previous = snapshot;
        setState({ target, session, snapshot });
      } catch {
        previous = undefined;
        setState({ target, session, error: "Invalid live chat snapshot" });
      }
    };
    events.onerror = () => {
      previous = undefined;
      setState({
        target,
        session,
        error: "Live connection lost. Reconnecting; drafts are not retried.",
      });
    };
    return () => events.close();
  }, [target, enabled, session]);
  return enabled && state.target === target && state.session === session
    ? state
    : { target, session };
}
