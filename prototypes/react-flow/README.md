# React Flow component playground

A standalone experiment based on the supplied Obsidian screenshots. It is **not** a Fernblick route, does not register a service worker, and never contacts Herdr, Pi, or the app backend. Components are newly implemented approximations of the screenshots, not imported Obsidian scripts.

## Run

Requires Node 24. From this directory:

```sh
npm ci
npm run dev
# http://127.0.0.1:5191
```

For access from another device on the same private Tailnet, use a specific local Tailnet IP (never a public/all-interface bind):

```sh
npm run dev -- --host <local-tailnet-ip>
```

Use a distinct port if 5191 is occupied. This is a temporary developer server, not a production deployment. Nothing changes the existing app service, proxy, sockets, or saved boards.

## Try

- Add **Boundary**, **Card**, **Icon Node**, **Detail Node**, **Table Node**, or **Comment Node** from the library. The initial example contains all six.
- Select a component and choose **Edit**, or double-click it. Change title, subtitle, color, icon or local image. Detail nodes have editable text/grouped-text fields and row highlights. Tables have editable columns, rows, and cells. Changes appear in a live preview before saving; Cancel/Escape discards them.
- Drag between the four connection dots to connect any two components. Double-click an edge to change its label/color. Select an edge and press Delete to remove it.
- Drag components, use the selected component's resize controls, Shift-click to select several, and duplicate or delete the selection. Drag the canvas to pan, scroll/pinch to zoom; Fit canvas and the minimap help navigate.
- Select a boundary **before adding** to create a component inside it, or use the selected component's boundary dropdown. Moving a boundary moves its children. Children may extend outside it; this is organizational grouping, not clipping. Boundary nesting is intentionally excluded.
- Changes are saved in **this browser and origin only** using localStorage, not sent to the server. Storage failures are visible. Download exports editable playground JSON as a backup; an import UI is not included. Reset asks before replacing the canvas with the example.

## Limits and omissions

No freehand tools, agent tools, real-time collaboration, undo/redo history, arbitrary uploaded React code, full Lucide search, Obsidian interoperability, or production migration. Included icons are a small searchable Lucide subset. Local raster images up to 2 MiB are supported (no SVG/remote URLs). The browser's storage quota may be smaller than several uploaded images; download before leaving if a save warning appears. Components are limited to 300, connections to 1,000, detail fields/rows to 100, and table columns to 20. Grouped detail fields are multiline text, not recursively nested components. Resizing a component does not scale its font or internal content.

React components render trusted code with saved JSON props. Each component is still a native React Flow node. Boundary containment uses `parentId`; connections use source/target node and handle IDs. The property dialogs update the same data that could later be exposed to validated agent tools, but that integration is deliberately absent here.

## Checks

```sh
npm run check          # model tests, TypeScript, production build
npm run test:browser   # requires running server, Chromium installed
# PLAYGROUND_URL=http://127.0.0.1:5191 npm run test:browser
```

Install Chromium with `npx playwright install chromium` if needed. The browser script uses fresh contexts, exercises only this playground, and saves evidence under the worktree's ignored `.runtime/react-flow-playground/`. It tests actual handle connections, component dialogs, grouping, persistence and a narrow touch viewport; this is not a physical-device pen/gesture assessment.

React Flow and Lucide are MIT-licensed; Nunito is bundled through `@fontsource/nunito` under OFL-1.1. Core renderer, icon, and font license notices are included under `public/licenses/` and copied into the standalone build. No React Flow Pro example code is used.
