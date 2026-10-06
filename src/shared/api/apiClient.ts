import {
  agentsResponseSchema,
  imageUploadSchema,
  createAgentRequestSchema,
  createAgentResponseSchema,
  createWorkspaceRequestSchema,
  createWorkspaceResponseSchema,
  createTabRequestSchema,
  createTabResponseSchema,
  terminalOutputSchema,
  type Agent,
  type CreateAgentRequest,
  type CreateWorkspaceRequest,
  type CreateTabRequest,
  type KeyName,
  type TerminalReadSource,
} from "./contracts";
import {
  ackSchema,
  COMPACT_TIMEOUT_MS,
  compactionResponseSchema,
  treeResponseSchema,
  navigationResponseSchema,
  skillsResponseSchema,
  type Target,
} from "../../../packages/pi-live-chat/protocol";

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

async function request(path: string, init?: RequestInit) {
  const response = await fetch(path, init);
  const body = (await response.json()) as unknown;

  if (!response.ok) {
    const message =
      typeof body === "object" && body !== null && "error" in body && typeof body.error === "string"
        ? body.error
        : "Request failed";
    throw new ApiError(response.status, message);
  }

  return body;
}

export async function getAgents() {
  return agentsResponseSchema.parse(await request("/api/agents"));
}

export async function createAgent(input: CreateAgentRequest) {
  const body = await request("/api/agents", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(createAgentRequestSchema.parse(input)),
  });
  return createAgentResponseSchema.parse(body).agent;
}

export async function createWorkspace(input: CreateWorkspaceRequest) {
  const body = await request("/api/workspaces", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(createWorkspaceRequestSchema.parse(input)),
  });
  return createWorkspaceResponseSchema.parse(body).workspace;
}

export async function createTab(input: CreateTabRequest) {
  const body = await request("/api/tabs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(createTabRequestSchema.parse(input)),
  });
  return createTabResponseSchema.parse(body).tab;
}

export async function renameAgent(target: string, name: string) {
  await request(`/api/agents/${encodeURIComponent(target)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
}

export async function renameTab(tabId: string, label: string) {
  await request(`/api/tabs/${encodeURIComponent(tabId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ label }),
  });
}

export async function closeTab(tabId: string) {
  await request(`/api/tabs/${encodeURIComponent(tabId)}`, { method: "DELETE" });
}

export async function restartAgent(target: string) {
  const body = (await request(`/api/agents/${encodeURIComponent(target)}/restart`, {
    method: "POST",
  })) as { agent: Agent };
  return body.agent;
}

export async function getPaneOutput(
  paneId: string,
  source: TerminalReadSource = "visible",
  signal?: AbortSignal,
) {
  const body = await request(
    `/api/panes/${encodeURIComponent(paneId)}/output?source=${source}&lines=600`,
    { signal },
  );
  return terminalOutputSchema.parse(body);
}

export async function sendPaneInput(paneId: string, text: string) {
  await request(`/api/panes/${encodeURIComponent(paneId)}/input`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
}

export async function sendPaneKey(paneId: string, key: KeyName) {
  await request(`/api/panes/${encodeURIComponent(paneId)}/keys`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key }),
  });
}

export async function getAgentOutput(
  target: string,
  source: TerminalReadSource = "visible",
  signal?: AbortSignal,
) {
  const body = await request(
    `/api/agents/${encodeURIComponent(target)}/output?source=${source}&lines=600`,
    { signal },
  );
  return terminalOutputSchema.parse(body);
}

export async function uploadImage(file: File, signal?: AbortSignal) {
  return imageUploadSchema.parse(
    await request("/api/uploads/images", {
      method: "POST",
      headers: { "Content-Type": file.type },
      body: file,
      signal,
    }),
  );
}
export async function getAgentSkills(pane: string, target: Target, signal?: AbortSignal) {
  const response = skillsResponseSchema.parse(
    await request(`/api/agents/${encodeURIComponent(pane)}/skills`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target }),
      signal,
    }),
  );
  if (
    response.target.runtime !== target.runtime ||
    response.target.epoch !== target.epoch ||
    response.target.sessionId !== target.sessionId
  )
    throw new Error("Pi session changed. Reopen Skills.");
  return response;
}
export async function getAgentTree(pane: string, target: Target) {
  const response = treeResponseSchema.parse(
    await request(`/api/agents/${encodeURIComponent(pane)}/tree`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target }),
    }),
  );
  return { ...response.tree, target: response.target };
}
export async function navigateAgentTree(pane: string, target: Target, entryId: string) {
  return navigationResponseSchema.parse(
    await request(`/api/agents/${encodeURIComponent(pane)}/tree-navigation`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target, entryId }),
    }),
  );
}

export async function compactAgentConversation(pane: string, target: Target) {
  let body: unknown;
  try {
    body = await request(`/api/agents/${encodeURIComponent(pane)}/compact`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target }),
      signal: AbortSignal.timeout(COMPACT_TIMEOUT_MS + 5000),
    });
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new Error("Compaction outcome uncertain. Check Pi before trying again.", {
      cause: error,
    });
  }
  const result = compactionResponseSchema.safeParse(body);
  if (
    !result.success ||
    result.data.target.runtime !== target.runtime ||
    result.data.target.sessionId !== target.sessionId ||
    result.data.target.epoch !== target.epoch
  )
    throw new Error("No valid compaction confirmation. Check Pi before trying again.");
  return result.data;
}

export async function chatCommand(
  target: string,
  identity: Target,
  action: "prompt" | "stop",
  text?: string,
  attachments: string[] = [],
  requestId?: string,
) {
  let body: unknown;
  try {
    body = await request(`/api/agents/${encodeURIComponent(target)}/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target: identity, text, attachments, requestId }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new Error(
      "Forwarding failed or timed out; delivery uncertain. Check Pi before retrying.",
      { cause: error },
    );
  }
  const ack = ackSchema.safeParse(body);
  if (!ack.success || (requestId && ack.data.id !== requestId))
    throw new Error(
      "Invalid forwarding acknowledgement; delivery uncertain. Check Pi before retrying.",
    );
  if (ack.data.outcome !== "invoked") throw new Error(ack.data.reason ?? "Pi rejected the command");
  return ack.data;
}

export async function sendAgentKey(target: string, key: KeyName) {
  await request(`/api/agents/${encodeURIComponent(target)}/keys`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key }),
  });
}
