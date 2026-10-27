import { useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type CollisionDetection,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { moveWorkspace } from "../../shared/api/apiClient";
import type { Workspace } from "../../shared/api/contracts";
import styles from "./WorkspaceReorder.module.css";
import a11yStyles from "../../styles/accessibility.module.css";

// Keep gaps between rows droppable, but never treat the rest of the page as a destination.
const workspaceCollision: CollisionDetection = (args) => {
  if (args.pointerCoordinates) {
    const { x, y } = args.pointerCoordinates;
    const rects = [...args.droppableRects.values()];
    if (
      !rects.length ||
      !rects.some((rect) => x >= rect.left && x <= rect.right) ||
      y < Math.min(...rects.map((rect) => rect.top)) ||
      y > Math.max(...rects.map((rect) => rect.bottom))
    )
      return [];
  }
  return closestCenter(args);
};

function SortableWorkspace({
  workspace,
  disabled,
  hidden,
  marker,
  onChoose,
  children,
}: {
  workspace: Workspace;
  disabled: boolean;
  hidden: boolean;
  marker?: "before" | "after";
  onChoose: () => void;
  children: (handle: ReactNode) => ReactNode;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } = useSortable({
    id: workspace.workspace_id,
    disabled,
  });
  return (
    <div
      ref={setNodeRef}
      className={styles.item}
      data-dragging={isDragging || undefined}
      data-marker={marker}
    >
      {children(
        hidden ? null : (
          <button
            {...attributes}
            {...listeners}
            ref={setActivatorNodeRef}
            type="button"
            className={styles.handle}
            aria-label={`Reorder ${workspace.label}`}
            aria-haspopup="dialog"
            aria-disabled={disabled || undefined}
            title="Drag to reorder, or click to choose a position"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              if (!disabled) onChoose();
            }}
          >
            <svg viewBox="0 0 16 24" width="16" height="24" aria-hidden="true">
              {[6, 12, 18].flatMap((cy) =>
                [5, 11].map((cx) => (
                  <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="1.5" fill="currentColor" />
                )),
              )}
            </svg>
          </button>
        ),
      )}
    </div>
  );
}

/** Keeps server order authoritative outside a pending move; never persists browser-only ordering. */
export function WorkspaceReorder<T extends Workspace>({
  workspaces,
  disabled,
  children,
}: {
  workspaces: T[];
  disabled: boolean;
  children: (workspace: T, handle: ReactNode) => ReactNode;
}) {
  const client = useQueryClient();
  const [optimistic, setOptimistic] = useState<string[] | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const dragOrder = useRef("");
  const [chosenId, setChosenId] = useState<string | null>(null);
  const [beforeId, setBeforeId] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const ordered = optimistic
    ? [...workspaces].sort((a, b) => {
        const rank = (id: string) =>
          optimistic.includes(id) ? optimistic.indexOf(id) : optimistic.length;
        return rank(a.workspace_id) - rank(b.workspace_id);
      })
    : workspaces;
  const ids = ordered.map((workspace) => workspace.workspace_id);
  const locked = disabled || saving || workspaces.length < 2;
  const active = workspaces.find((workspace) => workspace.workspace_id === activeId);
  const chosen = workspaces.find((workspace) => workspace.workspace_id === chosenId);

  async function move(workspaceId: string, beforeWorkspaceId: string | null) {
    if (locked || savingRef.current) return;
    const next = ids.filter((id) => id !== workspaceId);
    if (
      !ids.includes(workspaceId) ||
      (beforeWorkspaceId !== null && !next.includes(beforeWorkspaceId))
    )
      return;
    next.splice(
      beforeWorkspaceId === null ? next.length : next.indexOf(beforeWorkspaceId),
      0,
      workspaceId,
    );
    if (next.join() === ids.join()) return;
    savingRef.current = true;
    setSaving(true);
    setOptimistic(next);
    setError("");
    const label = workspaces.find((workspace) => workspace.workspace_id === workspaceId)?.label;
    setNotice(`Saving order for ${label}…`);
    try {
      await moveWorkspace({ workspaceId, beforeWorkspaceId });
      setNotice(`${label} moved to position ${next.indexOf(workspaceId) + 1} of ${next.length}.`);
    } catch (cause) {
      setError(
        `Could not save workspace order. ${cause instanceof Error ? cause.message : "Try again."}`,
      );
      setNotice("");
      setOptimistic(null);
    } finally {
      // Also reconcile uncertain outcomes (for example a timeout after Herdr applied the move).
      await client.invalidateQueries({ queryKey: ["agents"] });
      setOptimistic(null);
      setSaving(false);
      savingRef.current = false;
    }
  }

  function finishDrag({ active, over }: DragEndEvent) {
    setActiveId(null);
    setOverId(null);
    if (!over || active.id === over.id || locked) return;
    if (dragOrder.current !== workspaces.map((workspace) => workspace.workspace_id).join()) {
      setError("Workspace order changed while dragging. Please try again.");
      return;
    }
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    const next = arrayMove(ids, from, to);
    void move(String(active.id), next[to + 1] ?? null);
  }

  return (
    <>
      <DndContext
        sensors={sensors}
        collisionDetection={workspaceCollision}
        onDragStart={({ active }) => {
          dragOrder.current = workspaces.map((workspace) => workspace.workspace_id).join();
          setActiveId(String(active.id));
          setError("");
        }}
        onDragOver={({ over }) => setOverId(over ? String(over.id) : null)}
        onDragCancel={() => {
          setActiveId(null);
          setOverId(null);
        }}
        onDragEnd={finishDrag}
        accessibility={{
          screenReaderInstructions: {
            draggable:
              "Press Space to pick up a workspace, arrow keys to choose a position, Space to drop, or Escape to cancel. Click the handle to choose a destination without dragging.",
          },
          announcements: {
            onDragStart: ({ active }) =>
              `Picked up ${workspaces.find((w) => w.workspace_id === active.id)?.label}.`,
            onDragOver: ({ over }) =>
              over
                ? `Position ${ids.indexOf(String(over.id)) + 1} of ${ids.length}.`
                : "Outside the list.",
            onDragEnd: () => "Drag finished.",
            onDragCancel: () => "Reordering cancelled.",
          },
        }}
      >
        <SortableContext items={ids} strategy={() => null}>
          {ordered.map((workspace) => (
            <SortableWorkspace
              key={workspace.workspace_id}
              workspace={workspace}
              disabled={locked}
              hidden={disabled || workspaces.length < 2}
              marker={
                activeId && overId === workspace.workspace_id && activeId !== overId
                  ? ids.indexOf(activeId) < ids.indexOf(overId)
                    ? "after"
                    : "before"
                  : undefined
              }
              onChoose={() => {
                setChosenId(workspace.workspace_id);
                setBeforeId(ids[ids.indexOf(workspace.workspace_id) + 1] ?? "");
                dialog.current?.showModal();
              }}
            >
              {(handle) => children(workspace, handle)}
            </SortableWorkspace>
          ))}
        </SortableContext>
        <DragOverlay dropAnimation={null}>
          {active ? <div className={styles.preview}>{active.label}</div> : null}
        </DragOverlay>
      </DndContext>
      <p role="status" className={a11yStyles["sr-only"]}>
        {notice}
      </p>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      <dialog
        ref={dialog}
        className={styles.dialog}
        aria-label="Move workspace"
        onClose={() => setChosenId(null)}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            dialog.current?.close();
            if (chosenId) void move(chosenId, beforeId || null);
          }}
        >
          <h2>Move {chosen?.label}</h2>
          <label>
            Move before
            <select value={beforeId} onChange={(event) => setBeforeId(event.target.value)}>
              {ordered
                .filter((workspace) => workspace.workspace_id !== chosenId)
                .map((workspace) => (
                  <option key={workspace.workspace_id} value={workspace.workspace_id}>
                    {workspace.label}
                  </option>
                ))}
              <option value="">End of list</option>
            </select>
          </label>
          <div className={styles.actions}>
            <button type="button" onClick={() => dialog.current?.close()}>
              Cancel
            </button>
            <button type="submit" disabled={!chosen || locked}>
              Move
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
