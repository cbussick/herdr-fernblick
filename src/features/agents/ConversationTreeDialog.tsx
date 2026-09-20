import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PiTreeNode } from "../../shared/api/contracts";
import { getAgentTree, navigateAgentTree } from "../../shared/api/apiClient";
import { BranchIcon, CloseIcon, SearchIcon } from "../../shared/ui/Icons";

type Filter = "all" | "user" | "labels";

interface ConversationTreeDialogProps {
  open: boolean;
  target: string;
  onClose: () => void;
  onRestorePrompt: (text: string) => void;
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
              <span>{node.text}</span>
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
  onClose,
  onRestorePrompt,
}: ConversationTreeDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const treeQuery = useQuery({
    queryKey: ["agent-tree", target],
    queryFn: () => getAgentTree(target),
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
    mutationFn: (node: PiTreeNode) => navigateAgentTree(target, node.id),
    onSuccess: (_agent, node) => {
      if (node.role === "user") onRestorePrompt(node.text);
      void queryClient.invalidateQueries({ queryKey: ["agent-transcript", target] });
      void queryClient.invalidateQueries({ queryKey: ["agent-tree", target] });
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
          <button type="button" aria-label="Close conversation paths" onClick={onClose}>
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
            <p className="terminal-state">No matching messages.</p>
          )}
        </div>
        <footer className="conversation-tree-dialog__footer">
          <div>
            {selected ? (
              <>
                <strong>{selected.text}</strong>
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
          <button type="button" className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="primary-button"
            disabled={
              !selected || selected.id === treeQuery.data?.leafId || navigateMutation.isPending
            }
            onClick={() => selected && navigateMutation.mutate(selected)}
          >
            {navigateMutation.isPending
              ? "Switching…"
              : selected?.id === treeQuery.data?.leafId
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
