# HER-7: embedded whiteboard research

Research for [HER-7](https://linear.app/herdr-fernblick/issue/HER-7/add-collaborative-whiteboard), inspected 2026-10-02. This is a feasibility note, not an ADR or approved implementation plan. Primary documentation and upstream source were inspected alongside Fernblick at `a181764`. No application source or dependency manifests changed; whiteboard-library behavior was not runtime-tested. Upstream `main`/`master` are moving targets, not guarantees about a particular npm release. The final section distinguishes proposed local architecture from existing behavior.

## Bottom line

- **Excalidraw is the lower licensing-risk default for Fernblick:** MIT, embeddable, PNG export, editable JSON, and programmable elements. Its significant disadvantage is that a production collaboration service is **not included in the React component**; Fernblick would own the synchronization integration. [License](https://github.com/excalidraw/excalidraw/blob/master/LICENSE), [README: component versus hosted app](https://github.com/excalidraw/excalidraw/blob/master/README.md)
- **tldraw has the stronger documented integrated sync/editor/agent toolkit**, including an official Node-compatible sync backend, but current default licensing permits development only. Production requires separately granted rights and a valid key; do not select it on an assumption of free noncommercial production. [Sync](https://tldraw.dev/docs/sync), [editor](https://tldraw.dev/docs/editor), [actual license](https://github.com/tldraw/tldraw/blob/main/LICENSE.md)
- Both expose structured editing primitives, so neither requires replacing the existing coding agent with a second model loop. The tldraw agent starter is useful reference material, **not a prerequisite** to using the editor API. [Editor API](https://tldraw.dev/docs/editor), [agent starter](https://tldraw.dev/starter-kits/agent), [Excalidraw API](https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api/props/excalidraw-api)

## Licensing: verified text, not remembered rules

- **Excalidraw:** upstream license is MIT, granting use, modification, distribution, sublicensing and sale, conditioned on preserving copyright/permission notices. No production-key or noncommercial-only restriction appears in that license. Dependency/font notices still need their own inventory. [Actual LICENSE](https://github.com/excalidraw/excalidraw/blob/master/LICENSE)
- **Current tldraw:** `LICENSE.md` explicitly permits use in Development Environments and explicitly prohibits use in Production Environments under default terms. Development includes internal development/testing/staging not accessible to end users; production includes functionality supplied to end users/customers/public. It prohibits interfering with key enforcement and requires retaining notices and distributing the license. [Actual LICENSE.md](https://github.com/tldraw/tldraw/blob/main/LICENSE.md)
- The license provides trial and separate commercial-agreement exceptions and mentions alternative commercial/noncommercial licenses. Current community docs describe a free **100-day trial**, a commercial license, and a **discretionary hobby license** for noncommercial projects with a watermark. Those are grants to obtain, not automatic permissions from the default license. Production keys must be valid/active; key validation is documented as client-side and offline-capable. [License text](https://github.com/tldraw/tldraw/blob/main/LICENSE.md), [community licensing](https://tldraw.dev/community/license)
- **Concrete historical conflict:** the official `v3.0.0` license permitted commercial and noncommercial projects provided the watermark/key-validation restrictions were respected; an alternative license removed the watermark. That is materially different from current development-only terms. Neither that historical wording nor old “free noncommercial”/“key only removes branding” guidance establishes permission for today's SDK. Verify the exact shipped version's bundled license and any separate agreement. [Historical v3.0.0 text](https://github.com/tldraw/tldraw/blob/v3.0.0/LICENSE.md), [current text](https://github.com/tldraw/tldraw/blob/main/LICENSE.md)
- MIT-licensed examples do **not** relicense the tldraw SDK they depend on; current docs explicitly call the SDK source-available, not Open Source. Self-hosting its sync server does not bypass SDK licensing. [Community license](https://tldraw.dev/community/license)

## React 19 and mobile/iPad

- Current Excalidraw package source declares React/React DOM `^17.0.2 || ^18.2.0 || ^19.0.0`; current tldraw declares `^18.2.0 || ^19.2.1`. Thus “React 19” alone is insufficient to choose a tldraw version: check Fernblick's exact minor and the selected published package. No compatibility runtime test was performed. [Excalidraw package](https://github.com/excalidraw/excalidraw/blob/master/packages/excalidraw/package.json), [tldraw package](https://github.com/tldraw/tldraw/blob/main/packages/tldraw/package.json)
- tldraw documents touch/mouse/pen input, two-finger pinch, and automatic pen mode for direct-display pens including Apple Pencil. Its installation guide requires an explicitly sized parent and recommends `viewport-fit=cover` for full-screen safe areas. These are promising capabilities, not proof of good behavior inside Fernblick's chat layout. [Input handling](https://tldraw.dev/sdk-features/input-handling), [installation](https://tldraw.dev/docs/installation)
- Excalidraw's UI source contains phone/mobile layout branches and pen-mode controls. This establishes mobile-aware UI, but does not independently verify palm rejection, Pencil pressure quality, Safari memory limits, or keyboard behavior in a narrow chat pane. [LayerUI source](https://github.com/excalidraw/excalidraw/blob/master/packages/excalidraw/components/LayerUI.tsx)

## PNG and editable persistence

| Capability          | Excalidraw                                                                                                                                                                                                                                                                     | tldraw                                                                                                                                                                                                         |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PNG                 | `exportToBlob({elements, appState, files, ...})` defaults to `image/png`; canvas/SVG/clipboard exports also exist. [Export utilities](https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api/utils/export)                                                                | `editor.toImage(shapes, {format: 'png'})` returns a result containing a blob; image data URLs and SVG are also supported. [Image export](https://tldraw.dev/sdk-features/image-export)                         |
| Editable data       | `.excalidraw` is JSON; access elements, app state and binary files independently. [README](https://github.com/excalidraw/excalidraw/blob/master/README.md), [API](https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api/props/excalidraw-api)                            | `getSnapshot(editor.store)` / `loadSnapshot` preserve JSON document state; document and per-user session state are separate. Loading replaces the document. [Persistence](https://tldraw.dev/docs/persistence) |
| Local versus shared | A component's change callback is not server persistence; hosted app autosave is an app feature. [README](https://github.com/excalidraw/excalidraw/blob/master/README.md)                                                                                                       | `persistenceKey` stores document/assets in IndexedDB and syncs tabs, **not remote users**; network collaboration uses sync. [Persistence](https://tldraw.dev/docs/persistence)                                 |
| Image assets        | Current serializer includes referenced files for `"local"` export, but deliberately omits files for `"database"`; separate asset storage is necessary in that mode. [Serializer source](https://github.com/excalidraw/excalidraw/blob/master/packages/excalidraw/data/json.ts) | Assets are records referenced by shapes; default in-memory storage is inline base64, local persistence uses IndexedDB, and sync needs an application asset store. [Assets](https://tldraw.dev/docs/assets)     |

- **Documentation drift:** Excalidraw's general utils page shows an older object-style `serializeAsJSON` signature, whereas current source takes `(elements, appState, files, type)`. Use the selected release's types/source, not a copied docs snippet. [Utils docs](https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api/utils), [serializer source](https://github.com/excalidraw/excalidraw/blob/master/packages/excalidraw/data/json.ts)
- Excalidraw can embed scene data in exported PNG/SVG with `exportEmbedScene`, but that is optional and increases size. Ordinary PNG exports remain screenshots, not editable document state. Keep explicit structured persistence as the authority. [Export options](https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api/utils/export)

## Existing-agent shape editing: structured tools, not screenshots alone

- Excalidraw exposes `getSceneElements`, `getSceneElementsIncludingDeleted`, `getAppState`, `getFiles`, `addFiles`, `onChange`, and `updateScene`. `captureUpdate` controls undo capture, with `NEVER` documented for remote updates/initialization. This supports an application-owned read/edit bridge to the existing agent. [Imperative API](https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api/props/excalidraw-api)
- `convertToExcalidrawElements` builds full elements from simplified skeletons, including labeled containers and bound arrows. IDs regenerate by default; `regenerateIds: false` matters when agent operations reference stable IDs. Treat it as a creation helper, not a conflict-safe patch protocol. [Creating elements](https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api/excalidraw-element-skeleton)
- tldraw exposes shape reads plus `createShapes`, `updateShapes`, `deleteShapes`, and `editor.run` for batched changes/history control. An existing agent can target these without using tldraw's starter chat or provider configuration. [Editor](https://tldraw.dev/docs/editor)
- The official agent starter combines **screenshots AND structured shape data**, selection, viewport, off-screen clusters, history and lints; its action classes validate and execute edits. It is a complete example agent loop (`prompt`, `request`, `cancel`), not a promise that a screenshot magically enables editable output. Reusing its ideas differs from deploying its separate provider-backed worker/chat system. [Agent starter](https://tldraw.dev/starter-kits/agent)
- Research inference: give the existing agent bounded, validated shape operations and stable IDs, plus PNG visual context when useful. A screenshot alone cannot supply authoritative IDs, bindings, deletion state, or concurrency semantics. Both documented APIs support structured access; the Fernblick-specific proposal follows below. [Excalidraw API](https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api/props/excalidraw-api), [tldraw agent context](https://tldraw.dev/starter-kits/agent)

## Real-time sync on an existing Node server

- **tldraw:** `@tldraw/sync` provides client `useSync`; `@tldraw/sync-core` provides per-document `TLSocketRoom` for any JavaScript server supporting WebSockets. Official docs include Node examples and SQLite storage through `NodeSqliteWrapper` (`better-sqlite3` or `node:sqlite`), as well as in-memory storage with explicit snapshot persistence. Cloudflare Durable Objects/R2 are recommended templates, **not mandatory infrastructure**. [Sync architecture and Node storage](https://tldraw.dev/docs/sync)
- There must be exactly one authoritative `TLSocketRoom` globally per room; duplicate instances cause divergence/overwrites. Production additionally needs room authorization, upload limits, persistence, asset upload/download and optionally bookmark unfurling. Client/server versions and custom schemas must match appropriately. [Deployment concerns](https://tldraw.dev/docs/sync)
- `useSyncDemo`/hosted demo is for prototyping; official docs say production sync must be self-hosted. The demo is not a managed production collaboration offering, and neither embedding `Tldraw` nor visiting tldraw.com provisions Fernblick's backend. [Sync](https://tldraw.dev/docs/sync), [persistence demo](https://tldraw.dev/docs/persistence)
- **Excalidraw:** README explicitly places real-time collaboration, E2EE, share links, and autosave under the hosted app, distinct from npm editor features. `updateScene({collaborators})` supplies presence rendering, not a server or merge algorithm. [README](https://github.com/excalidraw/excalidraw/blob/master/README.md), [API](https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api/props/excalidraw-api)
- Official app source uses Socket.IO, encrypted messages, element restoration/reconciliation, and Firebase-backed persistence; an official `excalidraw-room` server example exists. These establish a self-hostable reference, **not** a drop-in collaboration prop. Adapting to Fernblick's Node server requires application-owned room protocol, reconciliation, persistence, authorization and assets; a plain WebSocket endpoint is not interchangeable with Socket.IO. [Collab.tsx](https://github.com/excalidraw/excalidraw/blob/master/excalidraw-app/collab/Collab.tsx), [Portal.tsx](https://github.com/excalidraw/excalidraw/blob/master/excalidraw-app/collab/Portal.tsx), [room server](https://github.com/excalidraw/excalidraw-room)

## External network, fonts, assets, and privacy caveats

- **Excalidraw:** fonts download from a CDN by default. Official self-hosting instructions copy `dist/prod/fonts` and set `window.EXCALIDRAW_ASSET_PATH` before loading the editor. Current font-loader source also defines an `esm.sh` fallback, so “set a local path” is not proof of zero external requests when files fail. Verify offline behavior and CSP against the exact build. [Installation](https://docs.excalidraw.com/docs/@excalidraw/excalidraw/installation), [font-loader source](https://github.com/excalidraw/excalidraw/blob/master/packages/excalidraw/fonts/ExcalidrawFontFace.ts)
- **tldraw:** default static assets use a public CDN; fonts, icons, embed-icons and translations can all be bundled/self-hosted via `@tldraw/assets` helpers and `assetUrls`. Google Fonts in the installation example is optional, not required. Uploaded media storage is separately configured with `TLAssetStore`; external embeds/bookmarks add their own network requirements. [Installation](https://tldraw.dev/docs/installation), [assets](https://tldraw.dev/docs/assets), [sync/unfurling](https://tldraw.dev/docs/sync)
- **Important docs/source discrepancy:** tldraw community docs say commercial/hobby licenses send no information, and trial pings send a key hash without PII. Current `LicenseManager.ts` instead has tracking branches for unlicensed production, evaluation, and watermark-bearing licenses; `maybeTrack` includes version, license type, license ID when available, SKU, **`window.location.href`**, and environment. Do not promise hobby/offline/privacy behavior solely from that docs page; examine the shipped release and actual granted license. The legal text explicitly permits usage-data transmission for compliance. [Community claims](https://tldraw.dev/community/license), [LicenseManager source](https://github.com/tldraw/tldraw/blob/main/packages/editor/src/lib/license/LicenseManager.ts), [license technical-enforcement section](https://github.com/tldraw/tldraw/blob/main/LICENSE.md)
- tldraw image export fetches/embeds fonts and media to make output self-contained. Both libraries need export testing with locally hosted fonts, imported images, unavailable resources and restrictive CSP; self-hosted sync alone does not eliminate asset/font traffic. [tldraw image export](https://tldraw.dev/sdk-features/image-export), [Excalidraw font source](https://github.com/excalidraw/excalidraw/blob/master/packages/excalidraw/fonts/ExcalidrawFontFace.ts)

## Small proof-of-concept questions / remaining uncertainty

1. Does the chosen published package mount cleanly against Fernblick's **exact** React 19 minor? Source peer ranges are evidence, not runtime verification.
2. On physical iPad/Safari: can Pencil draw while fingers pan without scrolling chat; do keyboard opening, split view, safe areas, toolbar hit targets and orientation changes remain usable?
3. Can a scene containing text, bound arrows, freehand strokes and an image survive JSON save/reload and PNG export, including cold-cache/offline fonts? Are export size/memory and mobile download/share behavior acceptable?
4. Can two users plus the existing agent concurrently move/edit/delete a bound shape without stale replacement, resurrected deletes, presence loops, or corrupted undo? Does reconnect after Node restart restore the same authoritative scene and assets?
5. Can validated, stable-ID agent actions preserve unrelated human edits and undo as intended, without a second model/provider integration?
6. For tldraw, what exact production grant/pricing/feature entitlement applies to collaboration, and what traffic occurs for that shipped version/key class? For either option, does a blocked-external-network test expose hidden asset fallbacks?

These are unresolved validation questions, not completed tests. No recommendation here constitutes legal approval.

## Fernblick fit and proposed interaction

This section is a recommendation, not existing behavior or an approved implementation specification. Local source was inspected at `a181764` on `main`. HER-7 had only an exploratory description, no acceptance criteria, no comments before this research claim, and no parent/children or blocking relations.

### Recommendation

Build an **editable sketchpad with explicit handoff to the existing agent**, rather than a separate whiteboard AI app. Keep the native scene document from day one; an image is an output of the board, not its storage format.

1. Start with fullscreen drawing and image sending. This is especially useful for UI sketches, markup, and explaining spatial ideas.
2. Add agent read/edit tools if diagram co-creation proves valuable: ask the agent to complete a flow, annotate a design, or place a proposed architecture next to the user's sketch.
3. Defer human-to-human multiplayer, invitations, cursor presence and continuous AI observation. They solve different problems from remote control of one's coding agent.

Default library choice for a lightweight, license-independent first version: Excalidraw. If robust simultaneous collaboration is a firm near-term requirement and the SDK license is acceptable, tldraw's sync stack is a stronger technical starting point. This is a product tradeoff, not a claim that Excalidraw cannot support agent editing.

### UI

- Chat gets a whiteboard button. It opens a full-viewport application screen with **Back | Whiteboard | Send to agent**. Do not depend on the browser Fullscreen API.
- Back returns to the same conversation and preserves both chat draft and board. Sending never deletes the editable board.
- Send opens a small preview/instruction sheet: e.g. “Implement this”, “Critique this”, “Add the missing connections”. Default to nonempty page bounds; offer selection/frame sending for large boards, rather than silently exporting only the current viewport.
- Initial version returns to chat after acknowledged forwarding. An optional chat drawer can later show the **same** Pi conversation while the board remains open; do not create a second AI session.
- In agent-edit mode, stay on the board, show the agent's activity, and identify its changed shapes. Apply edits in bounded, attributed batches with a safe undo/proposal policy, not silent whole-document replacement.
- Board saving and chat sending are separate states. Allow drawing while Pi is busy/offline, but keep the existing busy/disconnected prompt gates. “Saved” must not mean “sent”.
- Keep live agent identity/status subscribed while the board is open. Today `AgentConsole` only enables `useLiveChat` when `view === "chat"`; simply adding a third view would disable the subscription needed by Send. Lift the controller above both screens or keep the board within the chat controller. Do not unmount the current chat draft accidentally. [F1, F2]

### Existing image connection: reuse it

```text
Phone/iPad: board editor
  -> freeze scene revision and render PNG Blob
  -> POST /api/uploads/images
  -> POST /api/agents/:paneId/prompt
       {target, text, attachments: [uploadId]}
Fernblick Node server
  -> private Unix socket: send command with upload ID
Pi live-chat extension
  -> validates/reads local image
  -> pi.sendUserMessage(text + ImageContent)
Pi chat events -> extension -> server -> existing browser SSE
```

No new realtime transport or external whiteboard service is required for this version. The upload/prompt wire path already accepts image-only messages, up to ten PNG/JPEG/GIF/WebP images, 10 MiB each. Export must enforce those limits and sensible pixel dimensions; don't embed editable scene JSON into the PNG expecting the model to read it. Durable board JSON/assets require their own persistence design; the existing upload directory is temporary, and existing chat drafts are memory-only. [F1, F3, F4, F5]

The current prompt ACK means **forwarding invoked**, not guaranteed model acceptance. Preserve the existing uncertain-send behavior: no automatic prompt resend after reconnect, retain failed submission state, revalidate runtime/session/epoch after asynchronous work, and do not claim success beyond the ACK contract. Preserve the board regardless of send outcome. [F1, F3, F4]

### Actual collaboration: same agent, additional tools

Sending a screenshot does not give the agent access to an editable document. Add a small, validated capability surface (illustrative names):

- `board_read(boardId, region?)`: current revision, bounded structured shape summary, and an available revision-tagged preview.
- `board_apply(boardId, baseRevision, operations, operationId)`: create/update/delete supported shapes, labels and connectors; reject stale conflicting edits.
- Later, `board_render(boardId, revision, region?)`: render a current visual check if a reliable renderer exists.

Include board ID, sent revision, screenshot, and user instruction in the handoff. The agent uses tools to re-read current state when necessary. Do not dump every freehand point or every edit into the model's context, and do not run the model on every stroke. Canvas synchronization and model invocations are independent.

Pi supports custom tools through `pi.registerTool()`; its documentation and installed `ToolDefinition` support schema-validated arguments, asynchronous execution and structured results. These tools can belong to the existing standalone Fernblick extension or a companion package. No MCP server is required for Pi; an MCP adapter could later expose the same board service to other agent clients. [F6]

### Proposed connection topology

```text
Phone / iPad / desktop
   | existing HTTP prompt requests + chat SSE
   | new board HTTP API + board events
   |   (WebSocket for simultaneous realtime sync)
   v
Fernblick Node server, existing listener / tailnet
   |- board service: authoritative records, assets, revisions, persistence
   |- existing chat bridge
   |
   | private Unix socket: new correlated board tool requests/results
   v
Existing Pi process + registered board tools
   |
   v
Its existing model/provider connection
```

For **turn-based user–agent collaboration**, normal HTTP mutations plus a separate SSE board stream are sufficient. For **continuous simultaneous editing**, use a proper sync implementation over WebSockets (e.g. tldraw sync) rather than broadcasting whole-scene JSON and hoping changes merge. A WebSocket upgrade can share the existing Node HTTP listener; a second public TCP port, peer-to-peer/WebRTC connection, Cloudflare account or public tldraw room is not inherently required. Production tldraw sync must be self-hosted; its Node integration is documented. [F4, F7; tldraw sync source cited above]

The Unix socket is already bidirectional at the transport level, but its **current application protocol does not support agent-initiated board RPC**: it accepts chat snapshots and correlated replies; unknown frames fail validation. Add an explicit version/capability-gated request/result lane with independent bounded correlation/timeouts, or a separate private local board gateway. Do not disguise drawing changes as user prompts or share the current one-command-in-flight chat request slot with a stream of board operations. The agent needs board tools while it is working; the current idle-only _prompt_ gate must not be incorrectly applied to those tool calls. [F4, F8]

This topology assumes today's supported deployment: Fernblick and Pi on the same Linux host/Unix user. The phone can be remote through Tailscale. Existing live chat explicitly rejects remote Pi processes; cross-machine agents would need a separately authenticated/tunneled agent connection and are not solved automatically by board sync. [F5]

### State, conflicts, and phone suspension

- Give the board a stable `boardId`, initially associated with a Pi conversation/workspace. Do not use transient pane IDs, runtime IDs or connection epochs as the document identity. Keep those identities for validating the current agent's authority.
- Store authoritative board state and assets on the backend for agent-edit mode. Browser-local IndexedDB is useful for drafts/cache, but by itself does not share state with Pi or another device.
- Retain immutable sent revisions so “this diagram” in an old chat message remains meaningful. Conversation tree navigation must not silently rewind a shared board; decide whether an explicit branch action forks the board.
- Apply small shape-level operations with revision/precondition checks and server-side serialization. If the human changed a target shape since the agent read it, reject/re-read or present a proposal. Realtime sync resolves transport conflicts, not whether the agent's plan is now stale.
- Record operation IDs and authorship. A lost board-operation ACK can be reconciled/deduplicated against committed state; this does **not** change the existing prohibition on automatically replaying model prompts.
- Reconnect from authoritative board state and visibly track unsynced local work. Pause agent editing or offer a copy when merging offline edits is not supported; do not overwrite a newer board with an old cached scene.
- Avoid making the mobile browser the only executor of agent tools. iOS can suspend it when the user goes Back or locks the screen. Backend record operations can continue without an open browser, but **server record mutation is not a full editor/rendering engine**: text measurement, bindings/layout and image export need a tested adapter or headless renderer. A browser-only prototype is viable only with an explicit “board must remain open” limitation. tldraw's starter kit uses a client editor, and its export pipeline uses DOM/canvas; neither proves turnkey headless Pi integration. [F2; tldraw agent/image-export sources above]
- An initial agent-edit subset (boxes, text, connectors, annotations) is much easier to validate than arbitrary canvas automation. The human can retain freehand drawing, with screenshots supplying visual context.

### Security and verification gates

Reuse the private tailnet deployment, same-user socket permissions and current session association. Validate board access and Origin on HTTP mutations **and WebSocket upgrades**; a room ID is not authorization. Bound scene/asset sizes and operation rates, schema-validate actions, and reject arbitrary code/path execution. Keep assets/fonts same-origin; disable external embeds/unfurling initially rather than introducing unreviewed external requests or SSRF. Board content sent to the model still goes to the selected model provider, just like an existing image attachment. [F3, F4, F5]

Before implementation is considered proven, test:

1. React 19/Vite integration, local fonts, vendor CSS interaction, lazy-loaded bundle impact, finger/Apple Pencil, pinch/pan, keyboard, rotation and iPad/phone viewport behavior.
2. PNG legibility, selected-region export, large boards, missing images/fonts, dimension/10 MiB caps, and a vision-capable selected model.
3. Back/reopen/reload persistence, independent boards for independent chats, transcript snapshot links and an explicit branch policy.
4. Busy/stale-agent rejection, uncertain sends without retries, disconnect during upload/send, and no draft loss.
5. Real user/agent shape conflicts, duplicate operation IDs, undo attribution, server restart and phone sleep while an edit is in progress.
6. For tldraw, exact SDK/server versions, key/license approval and no demo-host dependence; for Excalidraw, the chosen sync/reconciliation implementation rather than an assumed packaged collaboration server.

### Local evidence

- **F1**: [AgentConsole.tsx](../src/features/agents/AgentConsole.tsx), especially `OutgoingDraft`, `useLiveChat`, `send`, `canSend`; [App.tsx](../src/app/App.tsx) mounts console by selected pane.
- **F2**: [useLiveChat.ts](../src/features/agents/useLiveChat.ts) and [live chat lifecycle contract](pi-live-chat.md).
- **F3**: [apiClient.ts](../src/shared/api/apiClient.ts), `uploadImage` and `chatCommand`; [protocol.ts](../packages/pi-live-chat/protocol.ts) size limits and target identity.
- **F4**: [server/http/server.ts](../server/http/server.ts), upload and prompt routes; [extension index.ts](../packages/pi-live-chat/index.ts), `send` handling; [docs/pi-live-chat.md](pi-live-chat.md).
- **F5**: [README.md](../README.md), deployment requirements; [standalone package README](../packages/pi-live-chat/README.md), Unix socket trust boundary, temporary images and supported process topology.
- **F6**: Installed pinned Pi 0.99.1 `node_modules/@earendil-works/pi-coding-agent/docs/extensions.md`, `examples/extensions/hello.ts`, and `dist/core/extensions/types.d.ts` (`ToolDefinition`, `registerTool`). [Upstream extension documentation](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md) may move beyond the installed version.
- **F7**: [server/index.ts](../server/index.ts) creates one Node HTTP server and the private bridge; [tldraw sync documentation](https://tldraw.dev/docs/sync) describes Node-hosted WebSocket rooms and persistence.
- **F8**: [server/pi/liveBridge.ts](../server/pi/liveBridge.ts), `accept` and `request`; [protocol.ts](../packages/pi-live-chat/protocol.ts), allowed frames; [transport.ts](../packages/pi-live-chat/transport.ts), bounded newline-delimited JSON.

## Research verification

The existing `npm run check` suite passed in the isolated research worktree (17 test files, 102 tests, typecheck, lint, formatting and production build). This verifies the unchanged application's baseline, **not** an implemented whiteboard integration. `npm ci` reported the same two dependency audit findings already documented in `docs/pi-live-chat.md` (one moderate, one high); no dependency upgrade was attempted. No live user agent was controlled and no implementation was merged or pushed.
