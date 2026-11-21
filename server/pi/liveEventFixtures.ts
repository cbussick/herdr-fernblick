import { randomUUID } from "node:crypto";
import type { Agent } from "../../src/shared/api/contracts.js";
import type { Snapshot } from "../../packages/pi-live-chat/protocol.js";

export const eventAgent: Agent = {
  pane_id: "w1:p1",
  agent_status: "idle",
  focused: false,
  revision: 1,
  tab_id: "tab",
  workspace_id: "workspace",
};
export function eventSnapshot(): Snapshot {
  return {
    type: "snapshot",
    version: 2,
    identity: {
      runtime: randomUUID(),
      pid: 1,
      processStart: "start",
      pane: "w1:p1",
      herdrSocket: "/fixture.sock",
      sessionId: "s",
      sessionFile: "/s.jsonl",
    },
    epoch: randomUUID(),
    seq: 1,
    busy: false,
    sendPending: false,
    truncated: false,
    messages: [{ id: "user", role: "user", text: "hello" }],
    status: { cwd: "/fixture", totalTokens: 0, cost: 0 },
  };
}
