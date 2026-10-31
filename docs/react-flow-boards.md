# Structured React Flow boards (isolated dogfood branch)

Worktree: `.worktrees/react-flow-boards`, branch `react-flow-boards`. This is not deployed to the main app. The original standalone playground remains separate and unchanged.

## What changes

New conversation boards default to React Flow: the six familiar component types, property dialogs, boundaries, connections, ink, whole-stroke erasing, drawing undo/redo, pen priority and canvas-scoped iPad Scribble suppression. Existing boards without an engine marker remain Excalidraw and use the original editor/export path. Opening a board never converts its format; imports cannot switch an existing board's engine.

The existing server-owned board store, per-conversation identity, revisions/CAS, SSE, request-scoped agent permissions, uncertain-write pause and IndexedDB recovery are reused. The browser no longer relies on the playground's localStorage. Work can continue through authorized agent tools without a user browser open. A new flow board is empty, not the prototype's demonstration diagram.

The flow document is a data-only `BoardScene` with `engine: "react-flow"`. Versioned `component`, `ink` and `connection` records live in `elements`; images live in validated raster `files`, referenced by component `imageId`. Components are trusted React code with bounded saved props—not uploaded JS/HTML, CSS, SVG or external-image URLs. Boundaries are one level deep. Flow and native elements cannot be mixed.

## Agent use

Current extensions expose `board_read`, `board_components` and `board_apply` only for a relevant authorized request. `board_read` identifies the engine and returns structured records and, on demand, a freshly rendered PNG including components, connections, images and ink. `board_components` discovers the six types, editable properties and their schema. Agents should prefer matching components for structured diagrams; they should not read/create a board for unrelated prompts.

On flow boards, create kinds are `boundary`, `card`, `icon`, `detail`, `table`, `comment`, and `connection`. Updates can change typed props, position, size, parent and connection details. Existing ink can be moved/resized/recolored/deleted, not generated as arbitrary paths by the agent. Asset IDs refer to images already on the board. Legacy boards retain their rectangle/text/arrow operation vocabulary.

Read targets and dependencies first. Create new parents/endpoints in a batch, read the new revision, then create dependent children/connections in a later batch. Include endpoint/parent IDs in `dependsOn`; server checks implicit relationships too. Group related changes with a shared `groupId`. Changed/deleted/unread targets skip their operation/group, rather than silently overwriting human changes. A parent/endpoint cannot be deleted while leaving live children/connections. No automatic retry follows uncertain outcomes.

Existing Pi processes need a user-initiated `/reload` to register the new tools. Do not reload/restart real agents automatically. Newly launched isolated agents must load this worktree's extension and inherit its private socket environment.

## Backups and recovery

Download uses a `fernblick-flow` version-1 JSON envelope containing the normalized scene. Imports are validated and explicitly confirmed, and use fresh record/asset IDs instead of reusing tombstoned IDs. They are a deliberate replacement, not a merge or engine converter. A durable local recovery checkpoint is required before import/clear; the previous local drawing remains downloadable. Storage failure cancels replacement. Ordinary autosave/network failure preserves the current draft and does not replay an uncertain write after reload.

The standalone playground's nodes/edges JSON and Obsidian libraries are different formats; they are not automatically migrated. Old Excalidraw scenes remain editable in Excalidraw. This branch introduces no shared linked-component/version-update system or partial-stroke eraser.

## Safely run a separate stack

Read [development isolation](development.md) before launching. A different HTTP port alone does **not** isolate agents. Create and verify a distinct Herdr session/socket and separate Pi processes first. Export matching private socket/session settings **in that Herdr/Pi environment as well as the backend**; backend-only exports cannot change already-running agents. Never point this branch at the live app's Herdr/Pi sockets or board directory.

Example configuration (replace the Herdr socket placeholder with the independently verified session):

```sh
cd .worktrees/react-flow-boards
npm ci
npm run build
umask 077
RUN="$PWD/.runtime/flow-dogfood"
mkdir -p "$RUN"/{bridge,boards,uploads,receipts,logs,sessions,index}
chmod 700 "$RUN" "$RUN"/{bridge,boards,uploads,receipts,logs,sessions,index}
export HERDR_SOCKET_PATH=/absolute/path/to/isolated-herdr.sock
export FERNBLICK_PI_SOCKET="$RUN/bridge/pi.sock"
export FERNBLICK_BOARD_DIR="$RUN/boards"
export FERNBLICK_UPLOAD_DIR="$RUN/uploads"
export FERNBLICK_READ_RECEIPT_DIR="$RUN/receipts"
export FERNBLICK_LOG_DIR="$RUN/logs"
export FERNBLICK_PI_SESSION_DIR="$RUN/sessions"
export FERNBLICK_SESSION_INDEX_DIR="$RUN/index"
export FERNBLICK_PI_ISOLATED=1
# Set FERNBLICK_HERDR_EXTENSION to the installed Herdr state extension if needed.
# Launch isolated Pi with --session-dir "$RUN/sessions" (plus this worktree's
# extension), or configure its own agent directory to use that same root.
HOST=127.0.0.1 PORT=8793 FERNBLICK_PUBLIC_URL=http://127.0.0.1:8793 npm start
```

Use a distinct, available private port and the URL actually reachable by the testing browser. For iPad testing bind a specific Tailnet address and set the public URL accordingly, or use a separately approved HTTPS proxy; do not bind all interfaces or change the existing app mapping. `FERNBLICK_PI_SESSION_DIR` scopes Fernblick's saved-session catalog; it does not relocate a Pi process's own save directory. Configure that in the isolated Pi launch too, including any agents created from the UI, or launch the dogfood agents manually. The built backend serves the renderer at its own origin. Vite's dev server is not the on-demand PNG renderer. No live test stack or new Herdr session is started automatically by this work.

## Verification

`VITEST_MAX_WORKERS=2 npm run check` covers protocols, authorization, storage, semantic operations, controller recovery, merging, editor adapters and build. Browser/renderer tests need the matching Playwright Chromium (and WebKit for UI coverage). After a build:

```sh
node tools/design/conversation-whiteboard.mjs # legacy editor regression
node tools/design/flow-whiteboard.mjs         # flow board/chat/save/recovery fixture
```

These fixtures intercept agent APIs and use disposable local storage; they never control user agents. Renderer integration tests use temporary static origins and fresh headless browsers, not a user's page. Real iPad/Pencil feel and Scribble-on behavior still require physical-device confirmation.
