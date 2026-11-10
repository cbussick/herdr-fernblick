# Production Flow board

## Integration seams

- Default `FlowBoardEditor` from `./FlowBoardEditor` accepts the type-imported `BoardEditorProps`, including the host's `onBeforeReplace` recovery handshake. It is the only editor; legacy boards are rejected at the schema/storage boundary. `onReady({fit})` exposes fit and `onReady(null)` clears readiness on unmount.
- `generation` is the external replacement/reconciliation signal. It clears provisional strokes and reconciles local edit history, replaces persistent state without publishing it, and leaves the viewport alone. Incoming changes are never undo steps: transactions touching changed remote records/assets are discarded, while unrelated local history survives. Ordinary local echoes and version-only updates do not invalidate history. Initial fitting happens once through React Flow.
- `history.ts` owns one bounded local undo/redo stack for components, primitives, ink and connections. Persistent layout-phase changes are grouped by pointer gesture (including all drag/resize samples), and selection/pan/measurement changes are excluded. Commands retain only affected records and needed raster assets, cap at 50 transactions / 32 MiB, validate graph/asset/size limits before publication, and preserve tombstones with increasing versions. Restores compare affected current content before applying. Clear/import retain the explicit recovery handshake and clear history rather than becoming ordinary undo steps. History is browser-memory only, not a saved-session or cross-device feature.
- The parent owns server saves, draft/recovery storage, conflict handling, and permissions. No storage or API clients are imported here. All emitted scenes pass the shared scene/graph schemas and the 12 MiB scene bound. Persistent records explicitly exclude React Flow state; genuine changes increment only the affected versions and deletions retain tombstones.
- Pointer activity (including drag/resize), and open edit/import/clear dialogs report interaction. Layout-phase changes publish before idle notifications. The parent should defer incoming generations during interactions.
- The outer board's focus/Escape handler must recognize `dialog[data-ui="flow-component-editor"][open]`. Every native Flow modal supplies this contract; its Escape/cancel event is also stopped locally.
- Import and clear require separate confirmation. The production host supplies `onBeforeReplace` to durably checkpoint the previous drawing in its recovery store before publishing a replacement. Failure or concurrent change cancels replacement; confirmation controls remain busy during the handshake. Imported identities are remapped, previous records become tombstones, and unused raster bytes can be collected without changing the recovery copy. Replacement then emits an ordinary validated `onChange` through the controller's normal save/reconciliation path. A local recovery copy is not a long-term backup; keep JSON downloads too.

## SVG primitives

`Primitives.tsx` shares explicit trusted SVG tags between the interactive node view and headless renderer. The wire contract is `type: "primitive"`, a five-value shape kind, and bounded typed `props`; operations use `drawing` to avoid overloading component props. Path commands are numeric tuples, never markup or raw path strings. `scene.ts` maps these to fixed-size, non-connectable nodes; standard React Flow selection, drag, resize, duplicate and delete preserve versions/tombstones. There is no manual drawing-props dialog or component parenting for primitives. See [agent syntax and limits](../../../docs/react-flow-boards.md#safe-svg-primitives).

## Headless entry

`flow-board-render.html` is wired into the parent's Vite inputs and the renderer's bounded request policy. It loads `src/flow-board-render.tsx`, which installs:

```ts
window.prepareFlowBoardScene(scene: BoardScene, scale?: number): Promise<{width:number;height:number}>
```

Call after navigation, await it, set the browser viewport to the returned integer size, then use a real page PNG screenshot at device scale factor **1**. Scale defaults to 1; `0 < scale <= 1` multiplies the fitted scale for byte-downscaling. Dimensions are bounded to 2048 per side and 2,097,152 pixels; the backend still owns the 2 MiB PNG byte loop, queue/deadline, raster-header preflight and browser sandbox/request policy.

The renderer uses the same trusted component content, safe SVG primitives, ink geometry and React Flow smooth-step connection geometry, with actual DOM text/table/image measurements. It has no controls, board API, storage, service workers, arbitrary HTML parsing, or remote assets. It waits for local fonts and raster decoding and fails on broken resources. CSS and fontsource assets are built under `/assets/`; backend interception must permit same-origin built **CSS, JS and local WOFF2 fonts**. HTML CSP allows only local script/CSS/fonts, inline styles and data raster images. The server must apply a compatible route CSP; a stricter HTTP header cannot be relaxed by the meta tag.

`scene.ts` contains the explicit persistence/backup boundary and `render.tsx` exports the renderer plus its bounded sizing helper. Neither imports prototype modules. The copied visuals retain the prototype's design; owned CSS/reset rules are module-scoped. Nunito is imported locally only within this feature. Redistributed dependency/font licenses are served under `/licenses/flow/`.

## Verification

`npx vitest run src/features/flow --maxWorkers=1` covers scene/version/tombstone/asset safety, shared-schema ink validation, erasing/resizing geometry, ID-scoped history, output sizing, and isolated built-page Chromium tests. The latter build both the renderer and `editor.test.html` in a disposable directory and serve only temporary static files on an ephemeral loopback port. They never contact a backend/Herdr socket or existing board. `editor.fixture.tsx` is test-only, not a production entry, and is excluded from the production Knip project. The editor and renderer production entries are wired separately.

Chromium checks cover modal cancellation, import confirmation, recovery-before-clear and failure cancellation, lock, generation/no-dirty-loop/history reset, change-before-idle, pen/palm priority and native iPad-touchstart cancellation, local DOM PNGs with tall tables/images/ink/connections, repeated/empty prepares, and explicit broken-image/font failure. Actual Apple Pencil/Scribble behavior still needs physical iPad Safari verification; Chromium can verify the native cancellation contract but cannot emulate iPadOS handwriting recognition.
