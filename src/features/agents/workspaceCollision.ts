import { closestCenter } from "@dnd-kit/core";
import type { CollisionDetection } from "@dnd-kit/core";

// Allow one touch-target's worth of overshoot below the list.
const bottomDropZone = 44;

// Above the list (including the search/header area), keep the first position
// reachable. Horizontal exits and distant space below the list still cancel.
export const workspaceCollision: CollisionDetection = (args) => {
  if (args.pointerCoordinates) {
    const { x, y } = args.pointerCoordinates;
    const rects = [...args.droppableRects.values()];
    if (
      !rects.length ||
      !rects.some((rect) => x >= rect.left && x <= rect.right) ||
      y < 0 ||
      y > Math.max(...rects.map((rect) => rect.bottom)) + bottomDropZone
    ) {
      return [];
    }
    // Dnd-kit measures collisionRect from the visible drag overlay, not the
    // original (possibly expanded) card. Reorder when its center crosses a
    // target's center, independently of where the handle was grabbed.
    const centerY = args.collisionRect.top + args.collisionRect.height / 2;
    const activeRect = args.droppableRects.get(args.active.id);
    return closestCenter({
      ...args,
      droppableContainers: args.droppableContainers.filter((container) => {
        const rect = args.droppableRects.get(container.id);
        if (!activeRect || !rect || container.id === args.active.id) {
          return true;
        }
        const midpoint = rect.top + rect.height / 2;
        return rect.top < activeRect.top ? centerY <= midpoint : centerY >= midpoint;
      }),
    });
  }
  return closestCenter(args);
};
