# Blue command desk

Implemented light-blue design for Fernblick. All application and Storybook styles use CSS Modules. The approved implementation is maintained on `main` and served by the normal production app on port 8787. Finished-screen gallery: <http://100.71.229.1:5197/> (same Tailnet required); each screen is grouped with its mobile, iPad portrait and desktop captures, with an extra iPad landscape filter. The same gallery is also served at <http://127.0.0.1:5197/>.

## Direction

Fernblick is a remote view onto coding agents, not an analytics dashboard. Its visual anchor is the Scout sheep-head mark and a pale-blue workspace rail. Keep the conversation quiet and readable; make the agent's status and the next action easy to find.

- Palette: sky/navigation `#e7f2fc`, mist/canvas `#f5f9fd`, white/surface `#ffffff`, navy/text `#17374f`, blue/action `#14669f`, pale blue/selection `#dceefc`. Keep distinct semantic warning, danger and success colors.
- Type: locally hosted Manrope variable for the interface; the existing monospace stack for terminal output and Pi session metadata. The font's complete SIL OFL 1.1 license is included in `src/styles/fonts/` and distributed at `/licenses/Manrope-OFL.txt` in both app and Storybook builds. See [font provenance](../../src/styles/fonts/README.md).
- Phone: one pane at a time, left-aligned workspace grouping, a reachable labeled Create control, and two header rows so status never competes with edit/view controls.
- iPad: single-pane/mobile navigation in portrait, persistent workspace rail in landscape. Below 1200px, portrait touch-screen dimensions keep the layout single-pane even if the software keyboard makes the viewport landscape. Desktop windows still use viewport orientation. A rail is shown at widths of at least 768px in landscape, or at least 1200px regardless of orientation. Rotation keeps the selected agent and draft.
- Desktop: rail plus a bounded conversation column, a one-row console header from 1152px, and a bounded composer instead of a viewport-wide input.
- Grouping: workspace containers correspond to actual projects, not arbitrary dashboard cards. The flat agent view uses white, bordered row surfaces. Expanded tool results use a white output area inside the same bordered accordion as their blue `read` header, with no gap or separate bubble corners. Distinct chat corners communicate speaker, not decoration.
- Accessibility: 44px console touch targets, visible focus, improved secondary-text contrast, safe-area padding and existing reduced-motion support. Existing status pulses and startup/send spinners respect reduced motion; no decorative animation.

The plan deliberately avoids metrics tiles, a decorative gradient hero, and dashboard ornament. A subtle blue rail and Scout carry the personality; status color retains its operational meaning. The full logo and navigation wordmark use the approved playful lettering; the rest of the interface keeps Manrope. See [branding sources and exports](../../design/branding/README.md). Existing gallery captures predate the Scout update; `branding.mjs` checks the new artwork separately.

## Captures

53 screens/states at each of these sizes:

| Device         | CSS pixels  |
| -------------- | ----------- |
| Phone          | 390 × 844   |
| iPad portrait  | 834 × 1194  |
| iPad landscape | 1194 × 834  |
| Desktop        | 1440 × 1000 |

212 finished application screenshots cover four viewport sizes. The default gallery groups 159 captures into 53 screen/state sections containing mobile, iPad portrait and desktop views; the iPad landscape filter contains the other 53 captures. Optional before/after mode retains the original baseline comparisons. Includes overview/search/empty states, create menu and forms, conversation/status/tool/images/composer, terminals, edit/restart/close/context actions, conversation paths and filters, loading and recovery states. These are the reachable screens and representative state variants, not every possible combination of arbitrary content and errors.

`capture.mjs` renders the actual app, drives its controls, intercepts **all** `/api/` traffic and replaces EventSource with deterministic fixtures. It never uses the real Herdr socket, launches an agent, sends a real prompt, or exposes private session content. Baseline is commit `2695548`. Baseline phone header controls overlap; baseline-only synthetic click dispatch permits capture of the obscured screens. Finished controls are exercised with normal pointer clicks. Browser tools select stable semantic hooks, not CSS Modules' generated class names.

Generated images, manifests and the served HTML are in ignored `design-gallery/`. Standalone loading, unavailable and empty states share an icon surface above their text: blue by default, red with a pale-red surface when the message is red. The empty conversation’s icon and “No messages yet” text are vertically centered in the chat panel. In-content chat notices (reconnect, transcript notices and failures) use compact inline icons. Sending follows current `main`: a button spinner during upload/forwarding, and draft clearing on a validated forwarding ACK, not on a Pi receipt. Failed/uncertain forwarding keeps the draft. Starting and connecting states use the bounded startup behavior from `main` with a decorative loading icon. All icons are hidden from assistive technology and status/alert/busy semantics are preserved.

The needs-input example is an explicit synthetic Herdr `blocked` status, not a claim that ordinary Pi replies or every Pi prompt automatically enter that state. The installed Herdr Pi integration v8 listens for extension-emitted `herdr:blocked` events. `WorkspaceList` in the expanded-tool capture is sample `read` output, not another UI workspace list.

The gallery opens on finished screens with all three viewports grouped by screen. It supports viewport/search filters, screenshot lightboxes, native-resolution zoom, previous/next buttons, arrow keys and Escape. Comparison mode: <http://100.71.229.1:5197/?phase=compare>. Before-only mode: <http://100.71.229.1:5197/?phase=before>.

## Reproduce

Install browser tooling separately from app dependencies:

```sh
npm install --prefix /tmp/fernblick-design-tools playwright pngjs pixelmatch
export PLAYWRIGHT_MODULE=/tmp/fernblick-design-tools/node_modules/playwright/index.mjs
# If Chromium/WebKit are not already installed:
/tmp/fernblick-design-tools/node_modules/.bin/playwright install chromium webkit
```

Build a separate checkout of baseline `2695548` and serve its `dist/` on loopback port 5195. Build a checkout of `main` (`npm ci && npm run check`) and serve its `dist/` on a temporary loopback port 5198. Neither needs a backend. Run from this task worktree:

```sh
node tools/design/capture.mjs before http://127.0.0.1:5195
node tools/design/capture.mjs after http://127.0.0.1:5198
# Optional targeted refresh of an existing complete gallery:
node tools/design/capture.mjs after http://127.0.0.1:5198 tool-open
python3 -m http.server 5197 --bind "$(tailscale ip -4)" --directory design-gallery
node tools/design/verify.mjs http://100.71.229.1:5197 http://127.0.0.1:5198
```

The gallery server exposes only static synthetic artifacts and binds to the Tailnet interface, not a public interface. A separate loopback listener can serve the same directory with `python3 -m http.server 5197 --bind 127.0.0.1 --directory design-gallery`; this supports standard localhost forwarding. Restrict access in the Tailnet policy if needed. After editing `gallery.html`, copy it to `design-gallery/index.html` or recapture.

## Workspace/tab grouping regression

After `npm run check`, serve this worktree's `dist/` on an unused loopback port:

```sh
PLAYWRIGHT_MODULE=/tmp/fernblick-design-tools/node_modules/playwright/index.mjs \
  node tools/design/workspace-tabs.mjs http://127.0.0.1:<frontend-port>
```

Checks Chromium and WebKit at small-phone (320px), phone, tablet
portrait/landscape and desktop sizes. Synthetic fixtures cover multiple
workspaces, same-tab agents, compact single-pane rows (including unnamed agents),
unboxed split-tab headings, mixed agent/shell tabs, pane-specific shell
navigation, search, collapse state across polling/search, and agent renaming
without changing the tab title. Shell-only workspace screenshots verify the
compact list rather than repeated nested tab cards. All API/SSE traffic is
intercepted; no live agents are controlled.
Screenshots are saved to ignored `design-gallery/workspace-tabs/`.

## PWA regression

After `npm run check`, run:

```sh
PLAYWRIGHT_MODULE=/tmp/fernblick-design-tools/node_modules/playwright/index.mjs \
  node tools/design/pwa.mjs
```

This creates and removes its own loopback server, copied build, and Chromium
profile. It serves a synthetic empty dashboard through the production HTTP
handler; no Herdr/Pi sockets are opened. It checks Chrome installability and
manifest/icon MIME types, PNG sizes, real service-worker installation, manual
updates across two windows with an unsent workspace draft, Later, offline relaunch,
API cache exclusion and automatic reconnect. Screenshots are written to ignored
`design-gallery/pwa/`. Optional `CHROMIUM_EXECUTABLE` selects a browser binary.

Physical Android/iOS installation, home-screen branding, external-link routing,
and real software-keyboard behavior still require device verification. Headless
installability checks do not establish which Android app handles a tapped link.

## Scout branding checks

After building, run these sequentially (one browser at a time):

```sh
PLAYWRIGHT_MODULE=/tmp/fernblick-design-tools/node_modules/playwright/index.mjs \
  node tools/design/branding.mjs
# Then run pwa.mjs as above for installation, updates and offline caching.
```

`branding.mjs` serves the actual build on an ephemeral loopback port with a
synthetic, delayed dashboard. It checks the full loading logo, immediate transition
to the overview, the transparent navigation head/wordmark, its accessible heading,
and no overflow or connection-status overlap at five phone, tablet and desktop
sizes, including a 320px phone and a narrow desktop sidebar. Canvas checks verify transparent corners in the UI assets,
fully opaque installed-app icons, and that no artwork escapes the maskable safe
circle. It preserves the existing PWA identity. Screenshots are saved under
`design-gallery/scout/`. Optional `CHROMIUM_EXECUTABLE` selects the browser binary.
No live agents or sockets are accessed. The PWA check also verifies that the
Scout head, full logo, wordmark and manifest icons are in the offline shell cache.

Use a Playwright version matching the installed browser. Scout verification used
Playwright 1.61.0 with its Chromium 149 / revision 1228. A newer driver paired with
an older cached browser can misreport `navigator.onLine` after offline navigation;
do not override app behavior or weaken assertions to hide that mismatch.

On a busy VPS, use `VITEST_MAX_WORKERS=1 npm run check` to bound test concurrency;
run browser checks only after that command finishes.

## Skills picker regression

```sh
PLAYWRIGHT_MODULE=/tmp/fernblick-design-tools/node_modules/playwright/index.mjs \
  node tools/design/skills.mjs http://<dev-host>:<vite-port>
# Optional: SKILLS_CASE=keyboard-height or SKILLS_CASE=visual-keyboard
```

Chromium/WebKit cover six phone/tablet/desktop cases, with intercepted API/SSE
fixtures only. At widths below 768px the native modal fills the **visual viewport**,
covering the header and composer, with search, a scrolling list and close control.
The short-phone check requires at least three complete skill rows instead of the
old single-row list. A separate fixture changes only VisualViewport height/offset
to simulate a keyboard and browser panning without changing the layout viewport.
Checks include background inertness, search focus, button-only opening (slash text
never activates the menu), keyboard selection, preserved text and image attachments,
no implicit sends, errors and reconnect.
Screenshots are in ignored `design-gallery/skills/`. These simulate keyboard
geometry; keyboard/IME behavior still needs physical-device confirmation.

## Keyboard layout regression

```sh
PLAYWRIGHT_MODULE=/tmp/fernblick-design-tools/node_modules/playwright/index.mjs \
  node tools/design/keyboard-layout.mjs http://<dev-host>:<vite-port>
```

This synthetic Chromium/WebKit check holds touch-screen dimensions in portrait
while shrinking the usable viewport, reproducing the keyboard-induced CSS
orientation flip at 768, 834 and 1024px widths. It checks full-width chat, composer
and skills-search focus, keyboard dismissal, physical rotation with the keyboard
open, draft preservation, back navigation and overview search. All API requests
and SSE are fixtures; no real agents are controlled. It simulates viewport changes,
not a physical iPadOS keyboard. Hook tests in `npm run check` also cover desktop
resizing, coarse-pointer detection, legacy orientation events and cleanup.

## Transcript following regression

```sh
PLAYWRIGHT_MODULE=/tmp/fernblick-design-tools/node_modules/playwright/index.mjs \
  node tools/design/transcript-follow.mjs http://127.0.0.1:<vite-port>
```

Chromium/WebKit use intercepted agent APIs and synthetic streaming snapshots at
tablet, phone (390px/3×) and Pixel-like (393px/2.75×) sizes. Phone cases enable mobile
emulation; the fixture includes a wrapped, mirrored session footer. Optional
`SCROLL_CASE=pixel` and `SCROLL_ENGINE=chromium` select a focused reproduction.

The Pixel-like case changes footer geometry twice in one browser turn after a
send, forcing intermediate scroll clamping before scroll/resize delivery. Before
the fix this left a 65px bottom gap and disabled following without reader input.
The test requires following to survive this, streamed replies and stepped viewport
expansion simulating keyboard dismissal. Multiline sends must also stay pinned
when ACK clears the draft. Click/touch and keyboard sends resume immediately,
before an ACK or echo; a later reader pause must survive ACKs and streamed output.

Wheel, PageUp and Chromium native-scrollbar checks cover reader pause/resume.
Chromium phone cases also exercise real touch input via CDP. Mobile WebKit models
touch intent with DOM events and changes scrollTop, using real browser scroll
events, because Playwright has no mobile WebKit wheel/drag API. No live agents or
Herdr sockets are used. Keyboard geometry is simulated, not a physical phone keyboard.

## Long conversation paths

`tree-pages.mjs` exercises the production dialog with the actual flat page reader
and synthetic in-memory session history. Chromium/WebKit cover five phone,
keyboard-height, tablet and desktop layouts, bounded paging, full-session search,
alternate paths, stale-page/error recovery, cancellation and full prompt restoration.
All HTTP/SSE traffic is intercepted; no live agents are controlled.

```sh
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs \
  node --import tsx tools/design/tree-pages.mjs http://127.0.0.1:<static-port>
```

See [conversation path paging](../../docs/conversation-paths.md) for the fixture
scope and protocol. Results are in ignored `design-gallery/tree-pages/`.

## Proposal regression comparison

Before the module migration, preserve the accepted proposal's `design-gallery/after/` directory separately. After capturing the finished implementation:

```sh
export PNGJS_MODULE=/tmp/fernblick-design-tools/node_modules/pngjs/lib/png.js
export PIXELMATCH_MODULE=/tmp/fernblick-design-tools/node_modules/pixelmatch/index.js
node tools/design/compare.mjs /path/to/preserved-proposal/after
```

The comparison writes `design-gallery/proposal-comparison.json` and fails if more than 0.05% of pixels change in any screenshot (pixelmatch color threshold 0.1, excluding anti-aliasing). Do not refresh the reference to conceal regressions. At the CSS Modules migration commit `d5971d7`, all 156 captures matched the accepted proposal with zero perceptually changed pixels. That historical report is preserved as `design-gallery/migration-comparison.json`. Subsequent requested portrait/sidebar, row, tool, copy and current-main chat behavior changes intentionally differ from that reference; the new 212 captures are validated by explicit browser assertions and visual review, not by silently replacing the old reference.

## Validation

- `npm run check`: formatting, CSS Modules conventions, lint, TypeScript, 81 tests and production build. Includes a real loopback HTTP test for the locally bundled font and full license, without any live-agent socket access.
- `npm run build:storybook`: builds component stories and copies the font license into the output.
- `verify.mjs`: Chromium and WebKit at eight phone/tablet/desktop sizes, including 1024×1366 portrait, 1024×768 landscape and 1194×834 landscape. Checks all 53 three-viewport screen groups (159 default screenshot cards), plus the 53 landscape captures, image decode, comparison/finished/zoom modes, search and device filters, keyboard navigation and close, before-only gallery, actual Manrope loading and the shipped license, orientation-aware rail visibility and rotation with selection preserved, white flat-agent rows, long-title console hit targets, red error icons, centered empty chat, back navigation, no page errors and no document-level horizontal overflow.
- `capture.mjs`: asserts layout for every finished detail screen, white agent rows, connected accordion header/output surfaces with keyboard toggle and visible focus, replacement empty-workspace copy, actual pending-send spinner, immediate ACK draft clearing and absence of obsolete sending/receipt/footer text.
- Visual review of phone overview/conversation/forms and both iPad orientations/desktop captures.

Remaining limitation: these are synthetic-data browser captures, not exercising live-agent commands or physical iPad/phone hardware. Production deployment should additionally be smoke-checked with read-only HTTP requests and frontend browser checks that intercept agent APIs.

The served gallery archive is retained in the primary checkout’s ignored `design-gallery/` directory after task-worktree cleanup. Ports 5195/5198 are temporary capture infrastructure and can be stopped once production is verified.
