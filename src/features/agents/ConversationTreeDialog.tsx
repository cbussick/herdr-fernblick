import a11yStyles from "../../styles/accessibility.module.css";
import treeStyles from "./ConversationTreeDialog.module.css";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import type { Target } from "../../../packages/pi-live-chat/protocol";
import type { TreePageRequest, TreePageRow } from "../../../packages/pi-live-chat/treeProtocol";
import { getAgentTreePage, navigateAgentTree } from "../../shared/api/apiClient";
import { BranchIcon, CloseIcon, SearchIcon } from "../../shared/ui/Icons";
import { StateIcon, StateNotice } from "../../shared/ui/StateFeedback";

type Filter = "all" | "user" | "labels";
interface ConversationTreeDialogProps {
  open: boolean;
  target: string;
  identity: Target;
  busy: boolean;
  onClose: () => void;
  onRestorePrompt: (text: string, attachments: string[]) => void;
}

export function ConversationTreeDialog({
  open,
  target,
  identity,
  busy,
  onClose,
  onRestorePrompt,
}: ConversationTreeDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const requests = useRef<Promise<unknown>>(Promise.resolve());
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [request, setRequest] = useState<TreePageRequest>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const searchPending =
    search.trim() !== (request.query ?? "") || filter !== (request.filter ?? "all");
  useEffect(() => {
    if (!searchPending) return;
    const timer = setTimeout(() => {
      setRequest((current) => ({ query: search.trim(), filter, focusId: current.focusId }));
      setSelectedId(null);
    }, 300);
    return () => clearTimeout(timer);
  }, [search, filter, searchPending]);
  const treeQuery = useQuery({
    queryKey: [
      "agent-tree-page",
      target,
      identity.runtime,
      identity.epoch,
      identity.sessionId,
      request,
      refresh,
    ],
    queryFn: ({ signal }) => {
      // Finish an in-flight read before issuing another: aborting browser fetch
      // does not cancel the bridge command. Superseded queued searches never run.
      const run = requests.current
        .catch(() => undefined)
        .then(async () => {
          signal.throwIfAborted();
          const result = await getAgentTreePage(target, identity, request);
          signal.throwIfAborted();
          return result;
        });
      requests.current = run;
      return run;
    },
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    gcTime: 0,
    placeholderData: keepPreviousData,
    enabled: open,
  });
  const page = treeQuery.data;
  const effectiveSelectedId = selectedId ?? page?.focusId ?? page?.leafId;
  const selected = page?.rows.find((row) => row.id === effectiveSelectedId) ?? null;
  const navigateMutation = useMutation({
    mutationFn: (row: TreePageRow) => navigateAgentTree(target, identity, row.id),
    retry: false,
    onSuccess: (result) => {
      if (result.prompt) onRestorePrompt(result.prompt.text, result.prompt.attachments);
      onClose();
    },
  });
  const reading = treeQuery.isFetching || treeQuery.isPlaceholderData || searchPending;
  const locked = reading || navigateMutation.isPending || busy;
  const currentAssistant = selected?.role === "assistant" && selected.id === page?.leafId;
  function browse(next: TreePageRequest) {
    setSearch(next.query ?? "");
    setFilter(next.filter ?? "all");
    setSelectedId(null);
    setRequest(next);
  }
  function load(offset: number) {
    if (!page) return;
    setSelectedId(null);
    setRequest({ ...request, offset, revision: page.revision });
  }
  function refreshPaths() {
    setSelectedId(null);
    setRequest(({ offset: _offset, revision: _revision, ...rest }) => rest);
    setRefresh((value) => value + 1);
  }
  useEffect(() => {
    const dialog = dialogRef.current;
    if (open && dialog && !dialog.open) dialog.showModal();
    if (!open && dialog?.open) dialog.close();
  }, [open]);
  useLayoutEffect(() => {
    if (!page || treeQuery.isPlaceholderData || !bodyRef.current) return;
    bodyRef.current.scrollTop = 0;
    if (page.mode === "path") {
      const focus = Array.from(
        bodyRef.current.querySelectorAll<HTMLElement>("[data-entry-id]"),
      ).find((element) => element.dataset.entryId === page.focusId);
      focus?.scrollIntoView({ block: "nearest" });
    }
  }, [page, treeQuery.isPlaceholderData]);
  return (
    <dialog
      ref={dialogRef}
      className={treeStyles["conversation-tree-dialog"]}
      aria-labelledby="conversation-tree-title"
      onClose={onClose}
      onCancel={(event) => {
        if (navigateMutation.isPending) event.preventDefault();
      }}
    >
      <div className={treeStyles["conversation-tree-dialog__layout"]}>
        <header className={treeStyles["conversation-tree-dialog__header"]}>
          <span className={treeStyles["conversation-tree-dialog__icon"]}>
            <BranchIcon />
          </span>
          <div>
            <h2 id="conversation-tree-title">Conversation paths</h2>
            <p>Browse a path, or search every message in this session.</p>
          </div>
          <button
            type="button"
            aria-label="Close conversation paths"
            onClick={onClose}
            disabled={navigateMutation.isPending}
          >
            <CloseIcon />
          </button>
        </header>
        <div className={treeStyles["conversation-tree-dialog__toolbar"]}>
          <label>
            <span className={a11yStyles["sr-only"]}>Search this conversation</span>
            <SearchIcon />
            <input
              type="search"
              value={search}
              maxLength={256}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search the whole conversation…"
              disabled={navigateMutation.isPending}
            />
          </label>
          <div aria-label="Filter conversation entries">
            {(["all", "user", "labels"] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={filter === value}
                onClick={() => setFilter(value)}
                disabled={navigateMutation.isPending}
              >
                {value === "all" ? "All messages" : value === "user" ? "Your prompts" : "Labels"}
              </button>
            ))}
          </div>
        </div>
        <section
          className={treeStyles["conversation-tree-dialog__history"]}
          aria-label="Conversation path browser"
        >
          <div className={treeStyles["conversation-tree-dialog__navigation"]}>
            <button type="button" onClick={() => browse({})} disabled={locked}>
              Current path
            </button>
            {page && page.rootCount > 1 ? (
              <button type="button" onClick={() => browse({ branchesOf: null })} disabled={locked}>
                Starting paths ({page.rootCount})
              </button>
            ) : null}
            <button
              type="button"
              onClick={refreshPaths}
              disabled={treeQuery.isFetching || navigateMutation.isPending || busy}
            >
              Refresh paths
            </button>
            <span role="status">
              {reading
                ? "Reading paths…"
                : page && !treeQuery.isError
                  ? `${page.mode === "search" ? "Matches" : page.mode === "branches" ? "Branches" : "Messages"} ${page.rows.length ? page.offset + 1 : 0}–${page.offset + page.rows.length} of ${page.total}`
                  : ""}
            </span>
          </div>
          <div
            ref={bodyRef}
            className={treeStyles["conversation-tree-dialog__body"]}
            aria-busy={reading}
          >
            {treeQuery.isPending ? (
              <div className={treeStyles["conversation-tree__state"]}>
                <StateIcon kind="loading" />
                <p>Reading conversation paths…</p>
              </div>
            ) : treeQuery.isError ? (
              <div
                className={treeStyles["conversation-tree__state"]}
                data-testid="terminal-state--error"
                role="alert"
              >
                <StateIcon kind="unavailable" />
                <p>Could not read conversation paths. {treeQuery.error.message}</p>
              </div>
            ) : page ? (
              <>
                {page.previousOffset !== null ? (
                  <button
                    type="button"
                    className={treeStyles["conversation-tree__page"]}
                    disabled={locked}
                    onClick={() => load(page.previousOffset!)}
                  >
                    {page.mode === "path" ? "Load earlier" : "Previous results"}
                  </button>
                ) : null}
                {page.rows.length ? (
                  <ol className={treeStyles["conversation-tree__list"]}>
                    {page.rows.map((row) => (
                      <li key={row.id}>
                        <div
                          className={treeStyles["conversation-tree__row"]}
                          data-testid="conversation-tree__row"
                          data-entry-id={row.id}
                        >
                          <button
                            type="button"
                            className={treeStyles["conversation-tree__message"]}
                            aria-pressed={selected?.id === row.id}
                            aria-current={row.id === page.leafId ? "location" : undefined}
                            disabled={locked}
                            onClick={() => setSelectedId(row.id)}
                          >
                            <span className={treeStyles["conversation-tree__meta"]}>
                              <strong>{row.role === "user" ? "You" : "Agent"}</strong>
                              {row.timestamp ? (
                                <time dateTime={row.timestamp}>
                                  {new Date(row.timestamp).toLocaleString([], {
                                    month: "short",
                                    day: "numeric",
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  })}
                                </time>
                              ) : null}
                              {row.id === page.leafId ? (
                                <small>Current point</small>
                              ) : !row.isActivePath ? (
                                <small>Other path</small>
                              ) : null}
                            </span>
                            <span className={treeStyles["conversation-tree__preview"]}>
                              {row.text || "Image attachment"}
                              {row.textTruncated ? "…" : ""}
                            </span>
                            {row.label ? <em>{row.label}</em> : null}
                          </button>
                          <div className={treeStyles["conversation-tree__branches"]}>
                            {page.mode !== "path" ? (
                              <button
                                type="button"
                                disabled={locked}
                                onClick={() => browse({ focusId: row.id })}
                              >
                                View path
                              </button>
                            ) : null}
                            {row.childCount > 1 ||
                            (row.id === page.leafId && row.childCount > 0) ? (
                              <button
                                type="button"
                                disabled={locked}
                                onClick={() => browse({ branchesOf: row.id })}
                              >
                                <BranchIcon />
                                {row.childCount === 1
                                  ? "View continuation"
                                  : `${row.childCount} branches`}
                              </button>
                            ) : null}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <div className={treeStyles["conversation-tree__state"]}>
                    <StateIcon kind="empty" />
                    <p>No matching messages.</p>
                  </div>
                )}
                {page.nextOffset !== null ? (
                  <button
                    type="button"
                    className={treeStyles["conversation-tree__page"]}
                    disabled={locked}
                    onClick={() => load(page.nextOffset!)}
                  >
                    {page.mode === "path" ? "Load later" : "More results"}
                  </button>
                ) : null}
              </>
            ) : null}
          </div>
        </section>
        <footer className={treeStyles["conversation-tree-dialog__footer"]}>
          <div>
            {selected && !treeQuery.isError ? (
              <>
                <strong>
                  {selected.text || "Image attachment"}
                  {selected.textTruncated ? "…" : ""}
                </strong>
                <span>
                  {selected.role === "user"
                    ? "The full prompt and available images will return to the composer"
                    : currentAssistant
                      ? "You are currently at this point"
                      : "Your next prompt will continue the conversation from here"}
                </span>
              </>
            ) : (
              <span>Select a message to continue from it.</span>
            )}
          </div>
          {navigateMutation.isError ? (
            <StateNotice kind="unavailable" role="alert">
              {navigateMutation.error.message}
            </StateNotice>
          ) : null}
          <button
            type="button"
            className={treeStyles["secondary-button"]}
            onClick={onClose}
            disabled={navigateMutation.isPending}
          >
            Cancel
          </button>
          <button
            type="button"
            className={treeStyles["primary-button"]}
            disabled={locked || treeQuery.isError || !selected || currentAssistant}
            onClick={() => selected && navigateMutation.mutate(selected)}
          >
            {navigateMutation.isPending
              ? "Switching…"
              : currentAssistant
                ? "Current point"
                : selected?.role === "user"
                  ? "Edit and branch"
                  : "Continue from here"}
          </button>
        </footer>
      </div>
    </dialog>
  );
}
