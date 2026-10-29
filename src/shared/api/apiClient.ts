import {
  agentsResponseSchema,
  markAgentReadRequestSchema,
  markAgentReadResponseSchema,
  savedChatsResponseSchema,
  deleteChatResponseSchema,
  resumeChatRequestSchema,
  imageUploadSchema,
  createAgentRequestSchema,
  createAgentResponseSchema,
  createWorkspaceRequestSchema,
  moveWorkspaceRequestSchema,
  moveWorkspaceResponseSchema,
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
  treePageResponseSchema,
  navigationResponseSchema,
  skillsResponseSchema,
  modelsResponseSchema,
  modelChangedResponseSchema,
  thinkingLevelsResponseSchema,
  thinkingChangedResponseSchema,
  defaultSavedResponseSchema,
  sameDefaultSelection,
  type DefaultSelection,
  type ThinkingLevel,
  type Target,
} from "../../../packages/pi-live-chat/protocol";

import {
  createReadReceiptDiagnostics,
  READ_RECEIPT_REQUEST_ID_HEADER,
} from "./readReceiptDiagnostics";

const logReadReceipt = createReadReceiptDiagnostics();

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

export async function markAgentRead(input: { paneId: string; completionId: string }) {
  // getRandomValues also works on non-secure loopback/tailnet HTTP pages.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  const requestId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  const started = performance.now();
  let category: Parameters<typeof logReadReceipt>[0]["category"] = "request_validation";
  let status: number | undefined;
  let signal: AbortSignal | undefined;
  try {
    const payload = JSON.stringify(markAgentReadRequestSchema.parse(input));
    signal = AbortSignal.timeout(10_000);
    category = "network";
    const response = await fetch(`/api/agents/${encodeURIComponent(input.paneId)}/read`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [READ_RECEIPT_REQUEST_ID_HEADER]: requestId,
      },
      body: payload,
      // Small idempotent receipts can finish even when the user closes the page.
      keepalive: true,
      signal,
    });
    status = response.status;
    category = response.ok
      ? "response_validation"
      : status === 404 || status === 409
        ? "stale"
        : "http";
    const body: unknown = await response.json();
    if (!response.ok) {
      const message =
        typeof body === "object" &&
        body !== null &&
        "error" in body &&
        typeof body.error === "string"
          ? body.error
          : "Request failed";
      throw new ApiError(status, message);
    }
    markAgentReadResponseSchema.parse(body);
    category = "success";
  } catch (error) {
    if (signal?.aborted) category = signal.reason?.name === "TimeoutError" ? "timeout" : "aborted";
    else if (error instanceof TypeError && category !== "request_validation") category = "network";
    throw error;
  } finally {
    logReadReceipt({
      boundary: "client",
      operation: "save",
      requestId,
      category,
      status,
      durationMs: performance.now() - started,
    });
  }
}

export async function getSavedChats() {
  return savedChatsResponseSchema.parse(await request("/api/chats"));
}

export async function deleteChat(id: string) {
  return deleteChatResponseSchema.parse(
    await request(`/api/chats/${encodeURIComponent(id)}`, { method: "DELETE" }),
  );
}

export async function resumeChat(input: { id: string; workspaceId: string }) {
  const body = await request(`/api/chats/${encodeURIComponent(input.id)}/resume`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(resumeChatRequestSchema.parse(input)),
  });
  return createAgentResponseSchema.parse(body).agent;
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

export async function moveWorkspace(input: {
  workspaceId: string;
  beforeWorkspaceId: string | null;
}) {
  const body = await request("/api/workspaces/move", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(moveWorkspaceRequestSchema.parse(input)),
    signal: AbortSignal.timeout(10_000),
  });
  moveWorkspaceResponseSchema.parse(body);
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
export async function getAgentModels(pane: string, target: Target, signal?: AbortSignal) {
  const result = modelsResponseSchema.parse(
    await request(`/api/agents/${encodeURIComponent(pane)}/models`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target }),
      signal,
    }),
  );
  if (
    result.target.runtime !== target.runtime ||
    result.target.sessionId !== target.sessionId ||
    result.target.epoch !== target.epoch
  )
    throw new Error("Pi session changed. Reopen the model picker.");
  return result;
}
export async function setAgentModel(
  pane: string,
  target: Target,
  provider: string,
  modelId: string,
) {
  let body: unknown;
  try {
    body = await request(`/api/agents/${encodeURIComponent(pane)}/set-model`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target, provider, modelId }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new Error("Model change outcome uncertain. Check Pi before trying again.", {
      cause: error,
    });
  }
  const result = modelChangedResponseSchema.safeParse(body);
  if (
    !result.success ||
    result.data.target.runtime !== target.runtime ||
    result.data.target.sessionId !== target.sessionId ||
    result.data.target.epoch !== target.epoch ||
    result.data.model.provider !== provider ||
    result.data.model.id !== modelId
  )
    throw new Error("No valid model change confirmation. Check Pi before trying again.");
  return result.data;
}
export async function getAgentThinkingLevels(pane: string, target: Target, signal?: AbortSignal) {
  const result = thinkingLevelsResponseSchema.parse(
    await request(`/api/agents/${encodeURIComponent(pane)}/thinking-levels`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target }),
      signal,
    }),
  );
  if (
    result.target.runtime !== target.runtime ||
    result.target.sessionId !== target.sessionId ||
    result.target.epoch !== target.epoch
  )
    throw new Error("Pi session changed. Reopen Thinking level.");
  return result;
}
export async function setAgentThinkingLevel(
  pane: string,
  target: Target,
  provider: string,
  modelId: string,
  level: ThinkingLevel,
) {
  let body: unknown;
  try {
    body = await request(`/api/agents/${encodeURIComponent(pane)}/set-thinking-level`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target, provider, modelId, level }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new Error("Thinking level change outcome uncertain. Check Pi before trying again.", {
      cause: error,
    });
  }
  const result = thinkingChangedResponseSchema.safeParse(body);
  if (
    !result.success ||
    result.data.target.runtime !== target.runtime ||
    result.data.target.sessionId !== target.sessionId ||
    result.data.target.epoch !== target.epoch ||
    result.data.provider !== provider ||
    result.data.modelId !== modelId ||
    result.data.level !== level
  )
    throw new Error("No valid thinking level confirmation. Check Pi before trying again.");
  return result.data;
}
export async function saveAgentGlobalDefault(
  pane: string,
  target: Target,
  selection: DefaultSelection,
) {
  let body: unknown;
  try {
    body = await request(`/api/agents/${encodeURIComponent(pane)}/save-default`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target, selection }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new Error("Default save outcome uncertain. Check Pi settings before trying again.", {
      cause: error,
    });
  }
  const result = defaultSavedResponseSchema.safeParse(body);
  if (
    !result.success ||
    result.data.target.runtime !== target.runtime ||
    result.data.target.sessionId !== target.sessionId ||
    result.data.target.epoch !== target.epoch ||
    !sameDefaultSelection(result.data.selection, selection)
  )
    throw new Error("No valid default save confirmation. Check Pi settings before trying again.");
  return result.data;
}
export async function getAgentTreePage(
  pane: string,
  target: Target,
  page: import("../../../packages/pi-live-chat/treeProtocol").TreePageRequest,
  signal?: AbortSignal,
) {
  const response = treePageResponseSchema.parse(
    await request(`/api/agents/${encodeURIComponent(pane)}/tree-page`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target, page }),
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(15_000)])
        : AbortSignal.timeout(15_000),
    }),
  );
  if (
    response.target.runtime !== target.runtime ||
    response.target.epoch !== target.epoch ||
    response.target.sessionId !== target.sessionId
  )
    throw new Error("Conversation session changed. Reopen conversation paths.");
  return response.page;
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
