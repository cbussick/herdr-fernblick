import { useLayoutEffect, useRef, useState } from "react";
import { compactAgentConversation } from "../../shared/api/apiClient";
import { matchesTarget, type Snapshot, type Target } from "../../../packages/pi-live-chat/protocol";

const uncertain = "Compaction outcome uncertain. Check Pi before trying again; no automatic retry.";

export function useConversationCompaction(
  pane: string,
  snapshot: Snapshot | undefined,
  connected: boolean,
) {
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error: boolean }>();
  const operation = useRef<{ target: Target; invalidated: boolean } | null>(null);
  const current = useRef({ snapshot, connected });
  const mounted = useRef(false);
  const previousIdentity = useRef<string | undefined>(undefined);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useLayoutEffect(() => {
    current.current = { snapshot, connected };
    const op = operation.current;
    const identity = snapshot
      ? JSON.stringify([snapshot.identity.runtime, snapshot.identity.sessionId, snapshot.epoch])
      : undefined;
    if (!op && (!connected || identity !== previousIdentity.current)) setNotice(undefined);
    previousIdentity.current = identity;
    if (op && (!connected || !snapshot || !matchesTarget(snapshot, op.target))) {
      op.invalidated = true;
      setNotice({ text: uncertain, error: true });
    }
  }, [snapshot, connected]);

  async function start(target: Target) {
    const live = current.current;
    if (
      operation.current ||
      !live.connected ||
      !live.snapshot ||
      !matchesTarget(live.snapshot, target) ||
      !live.snapshot.capabilities?.compact ||
      live.snapshot.busy ||
      live.snapshot.sendPending
    )
      return;
    const op = { target, invalidated: false };
    operation.current = op; // Synchronous guard for repeated taps before React renders.
    setPending(true);
    setNotice(undefined);
    try {
      await compactAgentConversation(pane, target);
      const latest = current.current;
      if (mounted.current)
        setNotice(
          op.invalidated ||
            !latest.connected ||
            !latest.snapshot ||
            !matchesTarget(latest.snapshot, target)
            ? { text: uncertain, error: true }
            : {
                text: "Conversation compacted. Older context summarized; your draft is unchanged.",
                error: false,
              },
        );
    } catch (error) {
      if (mounted.current)
        setNotice({
          text: op.invalidated
            ? uncertain
            : `${error instanceof Error ? error.message : "Compaction failed"}. Draft unchanged; check Pi before trying again.`,
          error: true,
        });
    } finally {
      operation.current = null;
      if (mounted.current) setPending(false);
    }
  }
  return { pending, notice, start, locked: () => Boolean(operation.current) };
}
