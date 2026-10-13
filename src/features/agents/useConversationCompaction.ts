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
  const lastOperation = useRef<typeof operation.current>(null);
  const current = useRef({ snapshot, connected });
  const mounted = useRef(false);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useLayoutEffect(() => {
    current.current = { snapshot, connected };
    const op = operation.current;
    const attempt = lastOperation.current;
    if (!op && attempt && connected && snapshot && !matchesTarget(snapshot, attempt.target)) {
      lastOperation.current = null;
      setNotice(undefined);
    }
    if (op) {
      // Losing the live stream does not establish that Pi replaced the target
      // or stopped the request. Only a fresh, mismatching snapshot invalidates it.
      if (connected && snapshot && !matchesTarget(snapshot, op.target)) op.invalidated = true;
      setNotice(
        op.invalidated
          ? { text: uncertain, error: true }
          : !connected || !snapshot
            ? {
                text: "Connection interrupted. Pi may still be compacting; reconnecting to check progress. No automatic retry.",
                error: false,
              }
            : undefined,
      );
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
    lastOperation.current = op;
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
  // A live activity report is stronger than a transport warning about progress,
  // but cannot establish success. Keep the error underneath so it returns when
  // activity ends without a correlated completion response.
  const attempt = lastOperation.current;
  const feedback =
    notice?.error &&
    attempt &&
    !attempt.invalidated &&
    connected &&
    snapshot?.compacting &&
    matchesTarget(snapshot, attempt.target)
      ? {
          text: "Pi is still compacting. Completion not yet confirmed; no automatic retry.",
          error: false,
        }
      : notice;
  return { pending, notice: feedback, start, locked: () => Boolean(operation.current) };
}
