# Whiteboard

Each supported Pi conversation has one persistent Excalidraw board. The board is created lazily when first opened or used by the agent. It belongs to the conversation, not the browser view: normal Fernblick chat, its board panel and the same conversation in Herdr's terminal use the same board. A new conversation or fork has a separate board. The backend stores the native scene and raster assets separately from ordinary chat uploads.

## Viewing and messaging

Open **Whiteboard** from live chat. The header identifies the agent and its workspace/tab; saving status is separate from agent activity. Back saves manual changes and returns to the same chat without clearing its draft or revoking an ongoing board request. Closing the browser does not end an authorized task while Pi and the backend remain connected.

On landscape screens at least 1024 CSS pixels wide, canvas and conversation sit side by side. Expand widens the conversation to half the workspace. On portrait/narrow screens, a compact conversation sits below the drawing; Expand temporarily hides the mounted editor and gives chat the workspace. Collapse restores it. These controls only resize the view. Transcript, draft and canvas zoom/pan remain intact. Fit drawing explicitly fits the current scene; incoming edits do not continually reset your viewport.

The board panel uses the ordinary bounded chat transcript, including images, tool results and thinking preference. Streaming follows only while near the bottom. Resize preserves reading position. Attachment previews close with Escape without dismissing the board. The application-update notification remains actionable outside the inert background app.

Send an instruction from either normal chat or the board panel, or type it directly into the same Pi session in Herdr. No attachment chip, share step or whiteboard mode is required to make board tools available. The board panel flushes unsaved manual changes before forwarding. Queued normal-chat image attachments stay in that composer; the board panel does not silently attach them.

Prompts do not automatically export or upload the drawing. The agent calls `board_read` when it needs the latest structured scene and rendered image, and `board_apply` to edit it. Read images describe the returned revision, not continuous observation of every stroke. Handwriting/sketch interpretation needs a vision-capable model and legible content. Image failures are explicit; there is no silent image-less fallback. Later summary pages can omit the image to avoid repeating it.

There is no separate Share drawing action or saved-snapshot history UI. Existing immutable captures remain stored and readable at their existing URLs; removing the interface does not delete old drawings or chat references.

## Open from Herdr's terminal

The existing Fernblick Pi extension registers **`/whiteboard`**. It opens/creates the current conversation's board and prints its Fernblick URL without sending an agent prompt, changing the terminal draft or interrupting work. On a local graphical Linux desktop it also asks the system browser to open that URL; SSH sessions only receive the URL. Agent tool calls never launch a browser.

Configure `FERNBLICK_PUBLIC_URL` on the backend to the browser-reachable Fernblick base URL, including any nonstandard port. Missing configuration produces setup guidance rather than an unusable localhost link. The URL includes pane and Pi session identity. Fernblick waits for live state and refuses to open a reused pane's different conversation. A link is a viewing hint, not authorization.

Fernblick-created agents explicitly load the live-chat extension. Herdr-created agents need that same package installed/configured in Pi, with the matching private socket environment; they do not need to have been opened in a browser first. Existing running Pi sessions need a user-initiated `/reload` or safe restart after extension changes.

## Tools and permission

The integration is the existing standalone **`@fernblick/pi-live-chat` Pi extension**, not a browser plugin or a separate agent. It communicates with the backend over the private, same-user Unix socket and preserves the existing validated process/pane/session mapping.

Tools are conversation-bound and requests are authorized independently of whether input came from terminal or web. Registering/exposing tools does not read the board or create one for unrelated messages. The extension/backend derive the board identity from the current session; the model cannot request another conversation's board by supplying an ID. A fresh request-scoped grant is obtained when needed. Stop access revokes the current request's board access; it cannot silently reacquire access within that request. A subsequent user request can obtain fresh access.

Session switches, forks, branch/runtime/connection changes, settlement, explicit revocation, stop and expiry invalidate relevant authority. Tokens remain private to the transport and never enter model input or tool output. Asynchronous rendering and mutations revalidate the grant and current target before returning/committing. Browser navigation does not revoke access.

On-demand images are rendered by the backend's bounded headless browser using the same pinned Excalidraw implementation, including native freehand and raster assets. The renderer cannot access agent APIs or external network resources, and creates no saved snapshot. See [renderer setup and limits](whiteboard-rendering.md).

Permission controls govern this integration, not Pi's existing shell/filesystem access. Revoking access cannot erase content already returned to the model. The app remains trusted controller access for intended Tailnet users, never a public internet service.

## Editing, conflicts, and recovery

The browser autosaves with compare-and-swap revisions and three-way reconciliation: the acknowledged base scene, current unsaved drawing, and latest server scene. Independent additions/changes from both sides survive either save order. Competing edits keep the local human record; new deletions win over concurrent edits, without treating unseen incoming additions as local deletions. Native order, tombstones and referenced image files are retained. Remote updates wait until the active stroke/text/multipoint gesture ends. Editor restoration-only fields are not mistaken for human changes. Incompatible native bindings/frames, fresh ID collisions, conflicting image assets or merged size limits still pause for explicit recovery rather than producing a broken board.

Only a `board_stale` HTTP 409, emitted before any server write, allows bounded refetch/reconciliation (up to three per flush). Generic failures, timeouts, disconnects and invalid ACKs never trigger automatic write retries. The draft stores its actual base scene and a paused marker before a write, so a crash/reload cannot replay an in-flight or uncertain save. New strokes arriving during reads/writes are carried forward. IndexedDB remains best-effort: unavailable/quota-failed storage is visible and is not a backup. Explicit Load latest first stores a recovery copy, refuses replacement if the human draws during its fetch, and keeps a Download previous local drawing action after replacement. Legacy dirty drafts without a trustworthy base stay paused.

Agent operations are checked against the latest scene inside the serialized commit lane. New standalone shapes tolerate unrelated drawing. Every update/delete target and explicitly declared `dependsOn` shape must have been returned by `board_read` at the submitted base revision and still match its complete native record. The model must declare dependencies for coordinate-only additions that rely on an existing shape. Read fingerprints are grant-local and bounded to live shape IDs. Changed/deleted/unread targets or dependencies skip their operation; shared `groupId` operations stay together. Independent eligible operations commit once, and the result lists `applied` IDs and `skipped` IDs/reasons. Deleting an already missing/deleted target reports `already_deleted` without a write. The agent is instructed to reread/reconsider skipped work and explain omissions, never replay applied operations. Invalid/unsupported operations still reject before committing any eligible edits; duplicate/tombstoned IDs and future revisions remain rejected. All-skipped outcomes are recorded for idempotency without incrementing the board revision.

Agent operations are deliberately narrow: create standalone rectangles, text, and arrows; move/recolor/resize supported unbound shapes; or delete them. Bound, grouped, locked, framed, or unsupported shapes cannot be edited through these tools. Read results are bounded, paginated summaries, without embedded files or full freehand paths. An on-demand read PNG provides that visual context for the returned revision; handwriting interpretation depends on the selected model's vision support and legibility. The agent can reread to inspect the latest rendered state after an edit. Agent editing is not a complete headless Excalidraw layout/rendering engine; complex diagrams should be reviewed in the editor. There is no live human multiplayer protocol, per-stroke model invocation, or separate AI service.

The backend owns durable state, so an authorized agent can finish edits while the browser is asleep or closed. The browser receives SSE invalidations and reloads the current scene on reconnection. Incoming edits are merged with unsaved browser drawing; unsupported relationship/asset conflicts retain explicit recovery. This is deterministic record-level reconciliation, not CRDT synchronization or collaborative undo. Applying a reconciled remote scene clears native undo history so Undo cannot silently remove agent work.

## Storage and limits

- `FERNBLICK_BOARD_DIR`: defaults to `~/.local/share/fernblick/boards`; use a distinct directory per development backend.
- The directory must be owned, non-symlinked, and `0700`; files are private and atomically replaced. Private ownership metadata links newly created/reopened boards to their Pi conversation for saved-chat cleanup; it is not sent to the browser. Legacy boards are identified using the current Herdr socket path. Grants are memory-only and do not survive backend restart.
- A native scene is limited to 12 MiB. PNG uploads retain the existing 10 MiB image limit. Board schemas additionally bound elements, files, text, operation batches, and coordinates.
- Up to 128 immutable captures per board and 128 recorded operation-batch outcomes per grant. Limits fail explicitly rather than silently deleting sent revisions or replay protection.
- Snapshot PNGs and downloadable `.excalidraw` scenes are served under `/api/boards/:boardId/snapshots/:snapshotId.png|json`. They are not temporary uploads. Deleting a saved session also deletes its associated board, native assets and snapshots unless another saved conversation references them. There is no automatic age-based retention cleanup; back up/manage the private directory as appropriate.

The editor and fonts are served locally. Excalidraw always appends a CDN font fallback even with its asset path configured; `tools/local-excalidraw-fonts.ts` rewrites that pinned declaration to same-origin in development and production, with fixture tests against both vendor bundles. This avoids fallback requests/CSP violations without relaxing network policy. `npm run prepare:whiteboard` copies fonts from the pinned Excalidraw package into ignored `public/excalidraw/fonts/`; dev-web/build hooks run it automatically. License notices are shipped in `public/licenses/excalidraw/`. Excalidraw's vendor stylesheet is imported with the lazy editor; Fernblick-owned styling uses CSS Modules. Production CSP permits the inline styles/data fonts/blob workers required by the editor, but not remote scripts or network services.

See [development isolation](development.md) for separate ports, proxies, Pi extensions, and Herdr sessions. Existing Pi agents need `/reload` (or a safe restart) to load this extension version before conversation-wide board tools and `/whiteboard` become available.
