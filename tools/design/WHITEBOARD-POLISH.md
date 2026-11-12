# Whiteboard polish validation

Implementation branch: `whiteboard-polish`, based on `ae91d3b`.
Design reference: `screen-gallery` proposal, including the left-aligned conversation toggle.

## Changes

- Shared whiteboard header with editor-owned actions rendered into a header slot.
- Searchable Add component dialog at all sizes; action follows color/size, separate from drawing modes.
- Fit drawing and minimap share a bottom-aligned navigation group with 12px spacing.
- White conversation bar, left-aligned 44px panel toggle, no idle Reply ready label.
  Working/errors and recovery actions remain visible.
- Initial read/editor initialization shows Scout + Loading whiteboard; edits are blocked,
  Back stays available, failed reads leave the loading state and expose recovery.
- Header persistence status distinguishes Saving, Unsynced, Offline and confirmed Saved;
  it has no duplicate loading label.
- Clear canvas retains confirmation and now has an accessible name and tooltip.
- Shared centered search-empty feedback and Clear search for models, skills, agents,
  workspaces and past sessions. Clearing changes only the query and restores search focus.
- Large table cells/rows scroll inside a bounded canvas table instead of expanding a node
  to an unreachable height. The full data remains editable and serialized.

## Reproduction

Run in this worktree, with its own dependencies:

```sh
VITEST_MAX_WORKERS=1 npm run check
node tools/design/flow-whiteboard.mjs
# Serve dist on a dedicated loopback port; all API/SSE calls below are mocked:
node tools/design/model-picker.mjs http://127.0.0.1:5210
node tools/design/skills.mjs http://127.0.0.1:5210
node tools/design/conversation-whiteboard.mjs
```

Browser fixtures do not contact Herdr/Pi sockets or modify real agents.
Flow evidence is written to `.runtime/flow-board-evidence/`; search evidence to
`design-gallery/model-picker/` and `design-gallery/skills/`.

## Coverage

- Chromium and WebKit: desktop, tablet landscape/portrait and phone board layouts.
- Loading → failure → reconnect → ready; no Saved during pending/failure.
- Sidebar removal, picker search/editor entry/focus restoration, selected/idle action styling.
- Left-aligned accessible conversation toggle and expand/collapse.
- Fit/minimap bounding boxes; 100-row × 20-column tables with long cell values,
  contained horizontal overflow and reachable Save/Cancel.
- Existing drawing, undo/redo, save-before-prompt, remote additions, failed writes,
  local draft recovery, independent JSON/PNG export and export errors.
- Search clearing, focus, draft retention, unchanged overview selection, restored results.
- Small phones and simulated keyboard/visual-viewport sizes in search fixtures.

Headless WebKit is not physical Safari certification. Physical iPad/iPhone rotation,
software keyboard, pencil input and browser chrome behavior remain manual checks.
No merge or deployment is implied by these checks.
