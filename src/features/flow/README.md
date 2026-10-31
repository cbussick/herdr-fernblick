# Production Flow board

## Integration seams

- Default `FlowBoardEditor` from `./FlowBoardEditor` accepts the existing, type-imported `BoardEditorProps` unchanged. The parent selects it only for `scene.engine === "react-flow"`; never reinterpret legacy boards. `onReady({fit})` exposes fit and `onReady(null)` clears readiness on unmount.
- `generation` is the external replacement/reconciliation signal. It clears ink history and provisional strokes, replaces persistent state without publishing it, and leaves the viewport alone. Ordinary local echoes need not increment generation. Initial fitting happens once through React Flow.
- The parent owns server saves, draft/recovery storage, conflict handling, and permissions. No storage or API clients are imported here. All emitted scenes pass the shared scene/graph schemas and the 12 MiB scene bound. Persistent records explicitly exclude React Flow state; genuine changes increment only the affected versions and deletions retain tombstones.
- Pointer activity (including drag/resize), and open edit/import/clear dialogs report interaction. Layout-phase changes publish before idle notifications. The parent should defer incoming generations during interactions.
- The outer board's focus/Escape handler must recognize `dialog[data-ui="flow-component-editor"][open]`. Every native Flow modal supplies this contract; its Escape/cancel event is also stopped locally.
- Imports require a separate replacement confirmation. Imported identities are remapped; previous records become tombstones. Import emits an ordinary validated `onChange`, so it uses the controller's normal draft/reconciliation path. **There is no durable pre-import recovery-copy callback in `BoardEditorProps`.** If the parent requires its explicit Load-latest-style recovery download for import as well, it must add/wire an `onBeforeReplace` handshake before approving replacement. Until then the confirmation instructs users to download first; this module does not pretend a draft is an immutable backup.

## Headless entry

Add `flow-board-render.html` to the parent's Vite inputs and static/CSP route policy. It loads `src/flow-board-render.tsx`, which installs:

```ts
window.prepareFlowBoardScene(scene: BoardScene, scale?: number): Promise<{width:number;height:number}>
```

Call after navigation, await it, set the browser viewport to the returned integer size, then use a real page PNG screenshot at device scale factor **1**. Scale defaults to 1; `0 < scale <= 1` multiplies the fitted scale for byte-downscaling. Dimensions are bounded to 2048 per side and 2,097,152 pixels; the backend still owns the 2 MiB PNG byte loop, queue/deadline, raster-header preflight and browser sandbox/request policy.

The renderer uses the same trusted component content, ink geometry and React Flow smooth-step connection geometry, with actual DOM text/table/image measurements. It has no controls, board API, storage, service workers, arbitrary HTML parsing, or remote assets. It waits for local fonts and raster decoding and fails on broken resources. CSS and fontsource assets are built under `/assets/`; backend interception must permit same-origin built **CSS, JS and local WOFF2/WOFF fonts**, not just the legacy renderer's JS/Excalidraw font paths. HTML CSP allows only local script/CSS/fonts, inline styles and data raster images. The server must apply a compatible route CSP; a stricter HTTP header cannot be relaxed by the meta tag.

`scene.ts` contains the explicit persistence/backup boundary and `render.tsx` exports the renderer plus its bounded sizing helper. Neither imports prototype modules. The copied visuals retain the prototype's design; owned CSS/reset rules are module-scoped. Nunito is imported locally only within this feature. License distribution is integration-owned.

## Verification

`npx vitest run src/features/flow --maxWorkers=1` covers scene/version/tombstone/asset safety, shared-schema ink validation, erasing/resizing geometry, ID-scoped history, output sizing, and isolated built-page Chromium tests. The latter build both the renderer and `editor.test.html` in a disposable directory and serve only temporary static files on an ephemeral loopback port. They never contact a backend/Herdr socket or existing board. `editor.fixture.tsx` is test-only, not a production entry; parent integration should exclude that helper from the production Knip project (as it already does for whiteboard test fixtures). Production Knip also needs the actual editor and renderer entry wiring before these modules/dependencies become reachable.

Chromium checks cover modal cancellation, import confirmation, lock, generation/no-dirty-loop/history reset, change-before-idle, pen/palm priority and native iPad-touchstart cancellation, local DOM PNGs with tall tables/images/ink/connections, repeated/empty prepares, and explicit broken-image/font failure. Actual Apple Pencil/Scribble behavior still needs physical iPad Safari verification; Chromium can verify the native cancellation contract but cannot emulate iPadOS handwriting recognition.
