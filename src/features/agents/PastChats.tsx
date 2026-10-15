import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getSavedChats, resumeChat } from "../../shared/api/apiClient";
import type { Agent, SavedChat, Workspace } from "../../shared/api/contracts";
import { ResumeChatDialog } from "./ResumeChatDialog";
import { StateIcon } from "../../shared/ui/StateFeedback";
import overviewStyles from "./agentOverview.module.css";
import styles from "./PastChats.module.css";

export function PastChats({
  query,
  workspaces,
  onResumed,
}: {
  query: string;
  workspaces: Workspace[];
  onResumed: (agent: Agent) => void;
}) {
  const client = useQueryClient();
  const [selectedChat, setSelectedChat] = useState<SavedChat | null>(null);
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
      setSelectedChat(null);
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
    <>
      <section className={styles.history} aria-label="Past chats" data-testid="past-chats">
        {chats.isPending && (
          <div className={overviewStyles["overview-empty"]} role="status" aria-busy="true">
            <StateIcon kind="loading" spinning />
            <p>Loading past chats…</p>
          </div>
        )}
        {chats.isError && (
          <div className={styles.error}>
            <p role="alert">{chats.error.message}</p>
            <button type="button" onClick={() => void chats.refetch()} disabled={chats.isFetching}>
              Try again
            </button>
          </div>
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
                  disabled={resume.isPending}
                  aria-label={`Resume ${chat.title}`}
                  onClick={() => {
                    resume.reset();
                    setSelectedChat(chat);
                  }}
                >
                  {resume.isPending && resume.variables.id === chat.id ? "Opening…" : "Resume"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>
      {selectedChat && (
        <ResumeChatDialog
          key={selectedChat.id}
          chat={selectedChat}
          workspaces={workspaces}
          pending={resume.isPending}
          error={resume.isError ? resume.error.message : undefined}
          onConfirm={(workspaceId) => resume.mutate({ id: selectedChat.id, workspaceId })}
          onClose={() => setSelectedChat(null)}
        />
      )}
    </>
  );
}
