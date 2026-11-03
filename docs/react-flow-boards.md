# Structured React Flow boards (isolated dogfood branch)

Worktree: `.worktrees/react-flow-boards`, branch `react-flow-boards`. This is not deployed to the main app. The original standalone playground remains separate and unchanged.

## What changes

New conversation boards default to React Flow: the six familiar component types, property dialogs, boundaries, connections, ink, whole-stroke erasing, drawing undo/redo, pen priority and canvas-scoped iPad Scribble suppression. Existing boards without an engine marker remain Excalidraw and use the original editor/export path. Opening a board never converts its format; imports cannot switch an existing board's engine.

The existing server-owned board store, per-conversation identity, revisions/CAS, SSE, request-scoped agent permissions, uncertain-write pause and IndexedDB recovery are reused. The browser no longer relies on the playground's localStorage. Work can continue through authorized agent tools without a user browser open. A new flow board is empty, not the prototype's demonstration diagram.

The flow document is a data-only `BoardScene` with `engine: "react-flow"`. Versioned `component`, `primitive`, `ink` and `connection` records live in `elements`; images live in validated raster `files`, referenced by component `imageId`. Components are trusted React code with bounded saved props—not uploaded JS/HTML, CSS, SVG or external-image URLs. Boundaries are one level deep. Flow and native elements cannot be mixed.

## Agent use

Current extensions expose `board_read`, `board_components` and `board_apply` only for a relevant authorized request. `board_read` identifies the engine and returns structured records and, on demand, a freshly rendered PNG including components, connections, images and ink. `board_components` discovers the six component types, the five SVG primitive kinds, editable properties and their schemas. Agents should prefer matching components for structured diagrams; they should not read/create a board for unrelated prompts.

On flow boards, create kinds are `boundary`, `card`, `icon`, `detail`, `table`, `comment`, and `connection`. Updates can change typed props, position, size, parent and connection details. Existing hand-drawn ink can be moved/resized/recolored/deleted. Agents create freeform drawings using validated `line`, `rectangle`, `ellipse`, `path` and `text` primitives. These SVG-backed objects are selectable, movable, resizable, duplicable and deletable; their drawing properties are edited through agent operations, not a new manual props dialog. Asset IDs refer to images already on the board. Legacy boards retain their rectangle/text/arrow operation vocabulary.

Read targets and dependencies first. Create new parents/endpoints in a batch, read the new revision, then create dependent children/connections in a later batch. Include endpoint/parent IDs in `dependsOn`; server checks implicit relationships too. Group related changes with a shared `groupId`. Changed/deleted/unread targets skip their operation/group, rather than silently overwriting human changes. A parent/endpoint cannot be deleted while leaving live children/connections. No automatic retry follows uncertain outcomes.

Existing Pi processes need a user-initiated `/reload` to register the new tools. Do not reload/restart real agents automatically. Newly launched isolated agents must load this worktree's extension and inherit its private socket environment.

## Safe SVG primitives

Create a primitive with its kind, scene position/dimensions, and optional `drawing` object. Update the same `drawing` field to change its appearance. Defaults and the full schema are returned by `board_components`. `stroke` is a hex color, `fill` is a hex color or `"none"`, and `strokeWidth` is 0–12. `start`/`end` and path command coordinates use normalized 0–100 coordinates inside the object bounds. Paths are typed tuples (`["M",x,y]`, `["L",x,y]`, `["Q",cx,cy,x,y]`, `["C",c1x,c1y,c2x,c2y,x,y]`, `["Z"]`), must start with M, and have at most 500 commands. Text is literal, supports explicit newlines (20 maximum, 2,000 characters), and uses Nunito; `fontSize` is 1–96 in these normalized SVG units. Long rich text belongs in components instead.

Example operation (alongside the normal batch revision/operation ID):

```json
{
  "op": "create",
  "id": "curve",
  "kind": "path",
  "x": 100,
  "y": 200,
  "width": 300,
  "height": 150,
  "drawing": {
    "stroke": "#17374f",
    "commands": [
      ["M", 0, 100],
      ["C", 25, 0, 75, 0, 100, 100]
    ]
  }
}
```

Primitive records share node/scene limits; live path control points count toward the 100,000 drawing-point budget. Read summaries include their bounded drawing data. Saving, recovery, backup import and browser-independent screenshots use the same trusted SVG renderer. Primitives are not boundary children or connection endpoints. Raw SVG/XML, arbitrary `d` strings, attribute bags, transforms, URLs, scripts, styles and embedded HTML are not accepted. Legacy Excalidraw tools are unchanged. Existing Pi processes require a user-initiated `/reload` to discover the updated schemas; refresh the test app before using the new records.

## Downloads

The board header’s **Export** button offers separate **Download JSON** and **Download PNG** actions. Nothing is bundled or automatically downloaded together. JSON preserves the editable document (legacy native boards keep their `.excalidraw` JSON extension). PNG captures the entire diagram, including components, tables, images, ink and primitives—not the viewport, toolbar or chat.

The dialog freezes the current valid local scene, including unsynced changes. PNG sends that detached scene to the authenticated backend renderer; it does not save/overwrite the board, send a prompt, grant agent access or create a stored snapshot. JSON remains browser-local and available even if PNG fails. Closing the dialog cancels the client request and prevents a late download. Backend work stays subject to the shared bounded queue/deadline and sandbox.

PNG resolution choices are Standard (up to 2048 px per side, 4 Mi pixels) and High (up to 4096 px per side, 16 Mi pixels, up to twice the dimensions). Both have a 16 MiB compressed-file limit; exceptionally large/high-entropy boards are fitted/downscaled. The smaller agent screenshot limits remain unchanged (2048 side, 2 Mi pixels, 2 MiB). PNG needs the backend and the current authorized Pi session; JSON does not. SVG whole-board export is not implemented yet.

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
