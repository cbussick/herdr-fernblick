# Conversation whiteboard

One persistent board belongs to each Pi conversation, not a browser mode. It is created lazily by opening it or by agent tool use. The existing Pi extension provides the same tools for terminal input, normal Fernblick chat and this board panel. See [the behavior and security contract](../../../docs/whiteboard.md) and [headless rendering](../../../docs/whiteboard-rendering.md).

## Ownership and layout

`AgentConsole` retains the live subscription, text draft, attachments and send mutation beneath the body-portal dialog. The header names the agent and workspace/tab. A captured runtime/epoch/session owns each mounted board. Confirmed identity replacement unmounts it, closes SSE, aborts pending browser work and persists the last local scene. Temporarily missing live state pauses sends without dismissing the canvas. Navigation/unmount never revokes the agent's current board request.

Explicit inertness and focus containment keep the background inactive while permitting Excalidraw's own portalled dialogs, chat image previews and the shared app-update notification. Back restores focus. The dialog follows the visual viewport so mobile keyboards do not cover the composer.

Landscape >=64rem uses a two-thirds canvas / one-third conversation layout; Expand widens chat to half the workspace. Narrow/portrait layouts use a compact bottom panel. Expand hides rather than unmounts the canvas; Collapse restores its zoom/pan and the same transcript/draft. Fit drawing is explicit so incoming edits never continually reset the viewport.

## Modules

- `boardApi.ts`: fixed Zod contracts, CAS saves, hint-only SSE, correlated invoked ACK validation and timeouts. Preserves `board_stale` for confirmed pre-write rejection; uncertain mutations never retry automatically. Legacy image-only sending remains a backend compatibility endpoint, not an exposed UI workflow.
- `BoardController.ts`: serialized save loop and three-way reconciliation against the actual acknowledged scene. Newer manual changes survive pending reads/saves. Defers incoming scenes during strokes, text and multipoint gestures. Only confirmed `board_stale` rejects permit bounded reconciliation; uncertain writes remain paused across reload. Explicit recovery archives the local scene before replacement and checks for human changes during fetch.
- `draftStore.ts`: IndexedDB drafts scoped by pane/session, with stable board ID, actual base scene/revision, paused state and a prior-recovery scene. Legacy dirty drafts without a base remain paused. Writes are serialized/coalesced. Deleting a saved chat removes matching local drafts/recovery copies; other browsers are not remotely wiped. Storage failures are visible. Legacy optional snapshot instructions remain preserved in existing drafts.
- `mergeScene.ts`: deterministic whole-record per-ID reconciliation. Independent changes survive, local competing edits win, and new deletions win. Preserves native ordering/files/tombstones and rejects unsafe relation/asset/ID/size conflicts; strips restoration-only changes from untouched native records.
- `BoardEditor.tsx`: loaded only after setting the local Excalidraw asset path. Preserves referenced native raster files, reports interaction boundaries and clears undo after applying a reconciled generation. Programmatic callbacks do not dirty-loop. Its imperative handle provides Fit drawing, not PNG export. The backend renderer owns on-demand images.
- `Whiteboard.tsx`: flushes manual changes before forwarding a panel prompt. Revalidates target, connection, capability and editor validity after the asynchronous save. No automatic screenshots/uploads, sharing sheet, snapshot history or repeated permission explanation. Save failures retain the draft; no automatic resend. Stop access is explicit and errors/last-known disconnected authority stay visible.
- `ConversationDock.tsx`: reuses the ordinary `ChatTranscript` and complete available bounded message array. Expansion changes geometry only, never filters messages. Cached messages survive transient unavailability but not owner replacement. Shares AgentConsole's ordinary text draft; hidden normal-chat images stay in that composer. Cmd/Ctrl+Enter sends; Enter and IME composition remain untouched.
- `boardLink.ts`: parses `/whiteboard` viewing links carrying pane AND Pi session. The live snapshot must match before opening; reused panes show an error. Consumes only its query keys and preserves unrelated URL/history state. A link is not an access grant.

`ChatTranscript` owns common message rendering, image galleries, truncation/empty states, thinking and reader-follow behavior. Resize/stream updates preserve reading position unless following the bottom. Image Escape closes the preview, not the surrounding board.

The parent checks captured board ownership, runtime/epoch/session, protocol, busy state and connection before sending. A synchronous latch prevents duplicate taps. Failed/uncertain sends retain the shared draft. A late ACK cannot clear a replacement conversation's draft. Ordinary text durability remains in-memory, not IndexedDB recovery.

## Validation

Run `npm run check` in the isolated worktree. Tests cover draft preservation, save-before-send, revalidation after asynchronous saves, no automatic uploads, explicit revocation, conversation-scoped links, programmatic versus manual changes, CAS/reconciliation and recovery.

After a production build, `node tools/design/conversation-whiteboard.mjs` runs Chromium/WebKit fixtures at mobile, portrait tablet and desktop sizes. All agent APIs/SSE are synthetic. It covers actual lazy Excalidraw loading, identity, expand/collapse, terminal deep links and stale-session rejection, normal-chat follow-ups, no automatic PNG uploads, keyboard-sized viewports and preserved drafts. Screenshots are written under ignored `.runtime/her-21-evidence/`. The existing `pwa-whiteboard.mjs` additionally verifies update-notification modality.

## Limitations

- Manual scene changes must reach durable storage before another interface/agent can read them. Closing a browser before pending storage work completes is not guaranteed recovery.
- Agent editing remains limited to supported standalone shapes. Native relation/asset/ID conflicts still need explicit recovery. Remote reconciliation clears local undo history rather than pretending to merge it.
- External links/embeddables are blocked. Download remains local. Existing immutable snapshot URLs are retained, but the sharing/history UI is removed.
- Interpreting handwriting and image content requires a vision-capable model. Images are fetched on demand, not continuously.
- Browser viewport emulation does not replace physical iPad/Apple Pencil testing.
