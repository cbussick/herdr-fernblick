import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getSavedChats, resumeChat } from "../../shared/api/apiClient";
import type { Agent, Workspace } from "../../shared/api/contracts";
import styles from "./PastChats.module.css";

export function PastChats({
  query,
  workspaces,
  onResumed,
  onCreateWorkspace,
}: {
  query: string;
  workspaces: Workspace[];
  onResumed: (agent: Agent) => void;
  onCreateWorkspace: () => void;
}) {
  const client = useQueryClient();
  const [workspaceId, setWorkspaceId] = useState("");
  const selectedWorkspace = workspaces.some((workspace) => workspace.workspace_id === workspaceId)
    ? workspaceId
    : (workspaces[0]?.workspace_id ?? "");
  const chats = useQuery({
    queryKey: ["saved-chats"],
    queryFn: getSavedChats,
    refetchInterval: 30_000,
  });
  const resume = useMutation({
    mutationFn: resumeChat,
    onSuccess: async (agent, { id }) => {
      await client.cancelQueries({ queryKey: ["saved-chats"] });
      client.setQueryData(
        ["saved-chats"],
        (current: Awaited<ReturnType<typeof getSavedChats>> | undefined) =>
          current
            ? {
                ...current,
                chats: current.chats.map((chat) =>
                  chat.id === id ? { ...chat, activePaneId: agent.pane_id } : chat,
                ),
              }
            : current,
      );
      void client.invalidateQueries({ queryKey: ["saved-chats"] });
      onResumed(agent);
    },
  });
  const search = query.trim().toLocaleLowerCase();
  const filtered =
    chats.data?.chats.filter(
      (chat) =>
        !chat.activePaneId &&
        [chat.title, chat.preview, chat.cwd].some((value) =>
          value.toLocaleLowerCase().includes(search),
        ),
    ) ?? [];

  return (
    <section className={styles.history} aria-label="Past chats" data-testid="past-chats">
      <div className={styles.toolbar}>
        <p>Resume a closed Pi conversation. Open conversations are in Agents.</p>
        {workspaces.length ? (
          <>
            <label htmlFor="resume-workspace">Open in workspace</label>
            <select
              id="resume-workspace"
              value={selectedWorkspace}
              disabled={resume.isPending}
              onChange={(event) => setWorkspaceId(event.target.value)}
            >
              {workspaces.map((workspace) => (
                <option key={workspace.workspace_id} value={workspace.workspace_id}>
                  {workspace.label}
                </option>
              ))}
            </select>
          </>
        ) : (
          <button type="button" onClick={onCreateWorkspace}>
            Create a workspace to resume chats
          </button>
        )}
        <button type="button" onClick={() => void chats.refetch()} disabled={chats.isFetching}>
          {chats.isFetching ? "Refreshing…" : "Refresh chats"}
        </button>
      </div>
      {chats.isPending && <p role="status">Loading past chats…</p>}
      {chats.isError && <p role="alert">{chats.error.message} Use Refresh chats to try again.</p>}
      {resume.isError && (
        <p role="alert">{resume.error.message} Check the agent list before retrying.</p>
      )}
      {chats.isSuccess && !filtered.length && (
        <p>
          {search
            ? "No chats match your search."
            : "No past chats yet. Saved conversations appear here after they close."}
        </p>
      )}
      <ul className={styles.list}>
        {filtered.map((chat) => (
          <li key={chat.id} className={styles.chat} data-testid="saved-chat">
            <h2>{chat.title}</h2>
            <p className={styles.path} title={chat.cwd}>
              {chat.cwd}
            </p>
            <div className={styles.footer}>
              <time dateTime={chat.updatedAt} title={new Date(chat.updatedAt).toLocaleString()}>
                {new Date(chat.updatedAt).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
              </time>
              <button
                type="button"
                disabled={resume.isPending || !selectedWorkspace}
                aria-label={`Resume ${chat.title}`}
                onClick={() => resume.mutate({ id: chat.id, workspaceId: selectedWorkspace })}
              >
                {resume.isPending && resume.variables.id === chat.id ? "Opening…" : "Resume"}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
