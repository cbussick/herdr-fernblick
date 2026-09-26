import { access } from "node:fs/promises";
import type { HerdrService } from "../herdr/herdrService.js";
import { getImageUploadPath } from "../uploads/imageUploads.js";
import type { QueueStore } from "./queueStore.js";

export class QueueDispatcher {
  private running = false;
  private stopped = false;
  private done: (() => void) | null = null;
  constructor(
    private readonly store: QueueStore,
    private readonly service: Pick<
      HerdrService,
      "getDashboard" | "promptAgentGuarded" | "readAgentTranscript"
    >,
  ) {}

  async stop() {
    this.stopped = true;
    if (this.running)
      await new Promise<void>((resolve) => {
        this.done = resolve;
      });
  }

  async tick() {
    if (this.stopped || this.running || !this.store.hasWork()) return;
    this.running = true;
    try {
      this.store.expireLostClaims();
      const { agents } = await this.service.getDashboard();
      for (const agent of agents) {
        const session = agent.agent_session?.value;
        if (!session || agent.agent !== "pi") continue;
        const sequence = agent.state_change_seq ?? 0;
        const submitted = this.store.submitted(agent.pane_id, session);
        if (submitted.length) {
          try {
            const transcript = await this.service.readAgentTranscript(agent.pane_id);
            for (const item of submitted) {
              const observed = transcript.messages.some(
                (message) =>
                  message.role === "user" &&
                  message.text === item.text &&
                  (message.timestamp ?? 0) >= (item.claimedAt ?? 0) &&
                  JSON.stringify(message.attachments ?? []) ===
                    JSON.stringify(item.attachments.map((id) => `/api/uploads/${id}`)),
              );
              if (observed) this.store.confirmObserved(agent.pane_id, session, item.id);
            }
          } catch {
            // An unreadable transcript cannot prove delivery; the timeout moves it to uncertain.
          }
        }
        if (agent.agent_status !== "idle" && agent.agent_status !== "done") continue;
        const item = this.store.claim(agent.pane_id, session, sequence);
        if (!item) continue;
        console.info(JSON.stringify({ event: "queue_claimed", messageId: item.id }));
        try {
          await Promise.all(item.attachments.map((id) => access(getImageUploadPath(id))));
        } catch {
          this.store.transition(
            item.id,
            "sending",
            "failed",
            "A temporary image is missing. Delete this message and queue it again without the image.",
          );
          console.warn(
            JSON.stringify({ event: "queue_failed", messageId: item.id, reason: "missing_image" }),
          );
          continue;
        }
        try {
          const fresh = (await this.service.getDashboard()).agents.find(
            (candidate) => candidate.pane_id === agent.pane_id,
          );
          if (fresh?.agent_session?.value !== session) {
            this.store.transition(
              item.id,
              "sending",
              "failed",
              "Agent session changed before delivery.",
            );
            console.warn(
              JSON.stringify({
                event: "queue_failed",
                messageId: item.id,
                reason: "session_changed",
              }),
            );
            continue;
          }
          if (fresh.agent_status !== "idle" && fresh.agent_status !== "done") {
            this.store.transition(item.id, "sending", "queued");
            continue;
          }
          this.store.updateClaimSequence(item.id, fresh.state_change_seq ?? 0);
          // Herdr does not offer an idempotency key: a lost response is NOT safe to retry.
          if (this.store.path === ":memory:")
            throw new Error("Queue database is not accessible to Pi");
          await this.service.promptAgentGuarded(agent.pane_id, session, item.id, this.store.path);
          this.store.transition(item.id, "sending", "submitted");
          console.info(JSON.stringify({ event: "queue_submitted", messageId: item.id }));
        } catch (error) {
          this.store.transition(
            item.id,
            "sending",
            "uncertain",
            "Delivery could not be confirmed. Check the agent before retrying.",
          );
          console.error(
            JSON.stringify({
              event: "queue_uncertain",
              messageId: item.id,
              reason: error instanceof Error ? error.name : "unknown",
            }),
          );
        }
      }
    } finally {
      this.running = false;
      this.done?.();
      this.done = null;
    }
  }
}
