import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { PiTreeNode, Target } from "../../../packages/pi-live-chat/protocol";
import { getAgentTree, navigateAgentTree } from "../../shared/api/apiClient";
import { BranchIcon, CloseIcon, SearchIcon } from "../../shared/ui/Icons";

type Filter = "all" | "user" | "labels";

interface ConversationTreeDialogProps {
  open: boolean;
  target: string;
  identity: Target;
  busy: boolean;
  onClose: () => void;
  onRestorePrompt: (text: string, attachments: string[]) => void;
}

function filterNodes(nodes: PiTreeNode[], query: string, filter: Filter): PiTreeNode[] {
  return nodes.flatMap((node) => {
    const children = filterNodes(node.children, query, filter);
    const matchesQuery =
      !query ||
      node.text.toLocaleLowerCase().includes(query) ||
      node.label?.toLocaleLowerCase().includes(query);
    const matchesFilter =
      filter === "all" ||
      (filter === "user" && node.role === "user") ||
      (filter === "labels" && Boolean(node.label));
    return matchesQuery && matchesFilter ? [{ ...node, children }] : children;
  });
}

function flatten(nodes: PiTreeNode[]): PiTreeNode[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children)]);
}

function TreeNodes({
  nodes,
  selectedId,
  onSelect,
}: {
  nodes: PiTreeNode[];
  selectedId: string | null;
  onSelect: (node: PiTreeNode) => void;
}) {
  return (
    <ul className="conversation-tree__list">
      {nodes.map((node) => (
        <li key={node.id}>
          <div className="conversation-tree__row">
            <span className="conversation-tree__node" aria-hidden="true" />
            <time>
              {node.timestamp
                ? new Date(node.timestamp).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                : ""}
            </time>
            <button
              type="button"
              aria-selected={selectedId === node.id}
              onClick={() => onSelect(node)}
            >
              <strong>{node.role === "user" ? "You" : "Agent"}</strong>
              <span>{node.text || "Image attachment"}</span>
              {node.label ? <em>{node.label}</em> : null}
            </button>
            {node.id === selectedId && node.isActivePath ? <small>You are here</small> : null}
          </div>
          {node.children.length ? (
            <TreeNodes nodes={node.children} selectedId={selectedId} onSelect={onSelect} />
          ) : null}
        </li>
      ))}
    </ul>
  );
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
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const treeQuery = useQuery({
    queryKey: ["agent-tree", target, identity.runtime, identity.epoch],
    queryFn: () => getAgentTree(target, identity),
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    gcTime: 0,
    enabled: open,
  });
  const allNodes = useMemo(() => flatten(treeQuery.data?.roots ?? []), [treeQuery.data]);
  const effectiveSelectedId = allNodes.some((node) => node.id === selectedId)
    ? selectedId
    : (treeQuery.data?.leafId ?? null);
  const selected = allNodes.find((node) => node.id === effectiveSelectedId) ?? null;
  const visibleNodes = useMemo(
    () => filterNodes(treeQuery.data?.roots ?? [], search.trim().toLocaleLowerCase(), filter),
    [filter, search, treeQuery.data],
  );
  const navigateMutation = useMutation({
    mutationFn: (node: PiTreeNode) => navigateAgentTree(target, treeQuery.data!.target, node.id),
    retry: false,
    onSuccess: (result) => {
      if (result.prompt) onRestorePrompt(result.prompt.text, result.prompt.attachments);
      onClose();
    },
  });

  useEffect(() => {
    const dialog = dialogRef.current;
    if (open && dialog && !dialog.open) dialog.showModal();
    if (!open && dialog?.open) dialog.close();
  }, [open]);
  return (
    <dialog
      ref={dialogRef}
      className="conversation-tree-dialog"
      aria-labelledby="conversation-tree-title"
      onClose={onClose}
      onCancel={(event) => {
        if (navigateMutation.isPending) event.preventDefault();
      }}
    >
      <div className="conversation-tree-dialog__layout">
        <header className="conversation-tree-dialog__header">
          <span className="conversation-tree-dialog__icon">
            <BranchIcon />
          </span>
          <div>
            <h2 id="conversation-tree-title">Conversation paths</h2>
            <p>Choose a message to continue from that point in the conversation.</p>
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
        <div className="conversation-tree-dialog__toolbar">
          <label>
            <span className="sr-only">Search this conversation</span>
            <SearchIcon />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search this conversation…"
            />
          </label>
          <div aria-label="Filter conversation entries">
            {(["all", "user", "labels"] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={filter === value}
                onClick={() => setFilter(value)}
              >
                {value === "all" ? "All messages" : value === "user" ? "Your prompts" : "Labels"}
              </button>
            ))}
          </div>
        </div>
        <div className="conversation-tree-dialog__body">
          {treeQuery.isPending ? (
            <p className="terminal-state" aria-busy="true">
              Reading conversation paths…
            </p>
          ) : treeQuery.isError ? (
            <p className="terminal-state terminal-state--error" role="alert">
              Could not read conversation paths. {treeQuery.error.message}
            </p>
          ) : visibleNodes.length ? (
            <TreeNodes
              nodes={visibleNodes}
              selectedId={effectiveSelectedId}
              onSelect={(node) => setSelectedId(node.id)}
            />
          ) : (
            <div className="terminal-state">
              <span className="empty-state-icon">
                <SearchIcon />
              </span>
              <p>No matching messages.</p>
            </div>
          )}
        </div>
        <footer className="conversation-tree-dialog__footer">
          <div>
            {selected ? (
              <>
                <strong>{selected.text || "Image attachment"}</strong>
                <span>
                  {selected.id === treeQuery.data?.leafId
                    ? "You are currently at this point"
                    : selected.role === "user"
                      ? "Your prompt will return to the composer so you can edit it"
                      : "Your next prompt will continue the conversation from here"}
                </span>
              </>
            ) : null}
          </div>
          {navigateMutation.isError ? <p role="alert">{navigateMutation.error.message}</p> : null}
          <button
            type="button"
            className="secondary-button"
            onClick={onClose}
            disabled={navigateMutation.isPending}
          >
            Cancel
          </button>
          <button
            type="button"
            className="primary-button"
            disabled={
              busy ||
              treeQuery.isFetching ||
              !selected ||
              (selected.role !== "user" && selected.id === treeQuery.data?.leafId) ||
              navigateMutation.isPending
            }
            onClick={() => selected && navigateMutation.mutate(selected)}
          >
            {navigateMutation.isPending
              ? "Switching…"
              : selected?.role !== "user" && selected?.id === treeQuery.data?.leafId
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
