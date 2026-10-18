import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { deleteChat, getSavedChats, resumeChat } from "../../shared/api/apiClient";
import type { Agent, SavedChat, Workspace } from "../../shared/api/contracts";
import { ResumeChatDialog } from "./ResumeChatDialog";
import { DeleteChatDialog } from "./DeleteChatDialog";
import { removeWhiteboardDrafts } from "../whiteboard/draftStore";
import { StateIcon } from "../../shared/ui/StateFeedback";
import overviewStyles from "./agentOverview.module.css";
import styles from "./PastChats.module.css";

export function PastChats({
  query,
  workspaces,
  onResumed,
  onRemoved,
}: {
  query: string;
  workspaces: Workspace[];
  onResumed: (agent: Agent) => void;
  onRemoved: () => void;
}) {
  const client = useQueryClient();
  const [selectedChat, setSelectedChat] = useState<SavedChat | null>(null);
  const [chatToDelete, setChatToDelete] = useState<SavedChat | null>(null);
  const historyRef = useRef<HTMLElement>(null);
  const [cleanupWarning, setCleanupWarning] = useState("");
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
  const deletion = useMutation({
    mutationFn: deleteChat,
    onSuccess: async (result, id) => {
      await client.cancelQueries({ queryKey: ["saved-chats"] });
      client.setQueryData(
        ["saved-chats"],
        (current: Awaited<ReturnType<typeof getSavedChats>> | undefined) =>
          current ? { ...current, chats: current.chats.filter((chat) => chat.id !== id) } : current,
      );
      setChatToDelete(null);
      onRemoved();
      void client.invalidateQueries({ queryKey: ["saved-chats"] });
      try {
        await removeWhiteboardDrafts(result.sessionId, result.boardIds);
      } catch {
        setCleanupWarning(
          "Session removed, but local whiteboard drafts could not be cleared in this browser.",
        );
      }
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
      <section
        ref={historyRef}
        tabIndex={-1}
        className={styles.history}
        aria-label="Past sessions"
        data-testid="past-chats"
      >
        {cleanupWarning && <p role="status">{cleanupWarning}</p>}
        {chats.isPending && (
          <div className={overviewStyles["overview-empty"]} role="status" aria-busy="true">
            <StateIcon kind="loading" spinning />
            <p>Loading past sessions…</p>
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
              ? "No sessions match your search."
              : "No past sessions yet. Saved sessions appear here after they close."}
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
                <div className={styles.actions}>
                  <button
                    type="button"
                    className={styles.delete}
                    disabled={resume.isPending || deletion.isPending}
                    aria-label={`Delete ${chat.title}`}
                    onClick={() => {
                      deletion.reset();
                      setCleanupWarning("");
                      setChatToDelete(chat);
                    }}
                  >
                    Delete
                  </button>
                  <button
                    type="button"
                    disabled={resume.isPending || deletion.isPending}
                    aria-label={`Resume ${chat.title}`}
                    onClick={() => {
                      resume.reset();
                      setSelectedChat(chat);
                    }}
                  >
                    {resume.isPending && resume.variables.id === chat.id ? "Opening…" : "Resume"}
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </section>
      {chatToDelete && (
        <DeleteChatDialog
          chat={chatToDelete}
          pending={deletion.isPending}
          error={deletion.isError ? deletion.error.message : undefined}
          onConfirm={() => deletion.mutate(chatToDelete.id)}
          onClose={() => setChatToDelete(null)}
          fallbackFocusRef={historyRef}
        />
      )}
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
