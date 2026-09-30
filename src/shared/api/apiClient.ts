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
} from "./contracts";
import {
  treeResponseSchema,
  navigationResponseSchema,
  type Target,
} from "../../../packages/pi-live-chat/protocol";

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
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

export async function getPaneOutput(paneId: string) {
  const body = await request(`/api/panes/${encodeURIComponent(paneId)}/output?lines=600`);
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

export async function getAgentOutput(target: string) {
  const body = await request(`/api/agents/${encodeURIComponent(target)}/output?lines=600`);
  return terminalOutputSchema.parse(body);
}

export async function uploadImage(file: File) {
  return imageUploadSchema.parse(
    await request("/api/uploads/images", {
      method: "POST",
      headers: { "Content-Type": file.type },
      body: file,
    }),
  );
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

export async function chatCommand(
  target: string,
  identity: Target,
  action: "prompt" | "stop",
  text?: string,
  attachments: string[] = [],
) {
  return request(`/api/agents/${encodeURIComponent(target)}/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ target: identity, text, attachments }),
  });
}

export async function sendAgentKey(target: string, key: KeyName) {
  await request(`/api/agents/${encodeURIComponent(target)}/keys`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key }),
  });
}
