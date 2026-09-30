# Blue command desk

Implemented light-blue design for Fernblick, isolated on `design/blue-responsive`. All application and Storybook styles use CSS Modules. The running production app is unchanged until integration/deployment is explicitly approved. Finished-screen gallery: <http://100.71.229.1:5197/> (same Tailnet required); each screen is grouped with its mobile, iPad and desktop captures.

## Direction

Fernblick is a remote view onto coding agents, not an analytics dashboard. Its visual anchor is a small horizon/window mark and a pale-blue workspace rail. Keep the conversation quiet and readable; make the agent's status and the next action easy to find.

- Palette: sky/navigation `#e7f2fc`, mist/canvas `#f5f9fd`, white/surface `#ffffff`, navy/text `#17374f`, blue/action `#14669f`, pale blue/selection `#dceefc`. Keep distinct semantic warning, danger and success colors.
- Type: locally hosted Manrope variable for the interface; the existing monospace stack for terminal output and Pi session metadata. The font's complete SIL OFL 1.1 license is included in `src/styles/fonts/` and distributed at `/licenses/Manrope-OFL.txt` in both app and Storybook builds. See [font provenance](../../src/styles/fonts/README.md).
- Phone: one pane at a time, left-aligned workspace grouping, a reachable labeled Create control, and two header rows so status never competes with edit/view controls.
- iPad: persistent 18rem workspace rail starting at 768px, with names and statuses on separate lines; conversation remains the primary surface.
- Desktop: rail plus a bounded conversation column, a one-row console header from 1152px, and a bounded composer instead of a viewport-wide input.
- Grouping: workspace containers correspond to actual projects, not arbitrary dashboard cards. The flat agent view stays a list. Distinct chat corners communicate speaker, not decoration.
- Accessibility: 44px console touch targets, visible focus, improved secondary-text contrast, safe-area padding and existing reduced-motion support. No new animation.

The plan deliberately avoids metrics tiles, a decorative gradient hero, and dashboard ornament. A subtle blue rail and the horizon mark carry the personality; status color retains its operational meaning.

## Captures

52 screens/states at each of these sizes:

| Device        | CSS pixels  |
| ------------- | ----------- |
| Phone         | 390 × 844   |
| iPad portrait | 834 × 1194  |
| Desktop       | 1440 × 1000 |

156 finished application screenshots are grouped into 52 screen/state sections, each containing mobile, iPad and desktop captures. The optional before/after mode retains 156 baseline comparisons. Includes overview/search/empty states, create menu and forms, conversation/status/tool/images/composer, terminals, edit/restart/close/context actions, conversation paths and filters, loading and recovery states. These are the reachable screens and representative state variants, not every possible combination of arbitrary content and errors.

`capture.mjs` renders the actual app, drives its controls, intercepts **all** `/api/` traffic and replaces EventSource with deterministic fixtures. It never uses the real Herdr socket, launches an agent, sends a real prompt, or exposes private session content. Baseline is commit `2695548`. Baseline phone header controls overlap; baseline-only synthetic click dispatch permits capture of the obscured screens. Finished controls are exercised with normal pointer clicks. Browser tools select stable semantic hooks, not CSS Modules' generated class names.

Generated images, manifests and the served HTML are in ignored `design-gallery/`. Standalone loading, unavailable and empty states share an icon surface above their text: blue by default, red with a pale-red surface when the message is red. The empty conversation’s icon and “No messages yet” text are vertically centered in the chat panel. In-content chat notices (reconnect, sending, waiting for receipt, transcript notices and failures) use compact inline icons to preserve conversation space. Icons are decorative and hidden from assistive technology; existing status/alert and busy semantics are preserved. No new animation was added.

The gallery opens on finished screens with all three viewports grouped by screen. It supports viewport/search filters, screenshot lightboxes, native-resolution zoom, previous/next buttons, arrow keys and Escape. Comparison mode: <http://100.71.229.1:5197/?phase=compare>. Before-only mode: <http://100.71.229.1:5197/?phase=before>.

## Reproduce

Install browser tooling separately from app dependencies:

```sh
npm install --prefix /tmp/fernblick-design-tools playwright pngjs pixelmatch
export PLAYWRIGHT_MODULE=/tmp/fernblick-design-tools/node_modules/playwright/index.mjs
# If Chromium/WebKit are not already installed:
/tmp/fernblick-design-tools/node_modules/.bin/playwright install chromium webkit
```

Build a separate checkout of baseline `2695548` and serve its `dist/` on loopback port 5195. Build this task worktree (`npm ci && npm run check`) and serve its `dist/` on loopback port 5198. Neither needs a backend. Run from this task worktree:

```sh
node tools/design/capture.mjs before http://127.0.0.1:5195
node tools/design/capture.mjs after http://127.0.0.1:5198
python3 -m http.server 5197 --bind "$(tailscale ip -4)" --directory design-gallery
node tools/design/verify.mjs http://100.71.229.1:5197 http://127.0.0.1:5198
```

The gallery server exposes only static synthetic artifacts and binds to the Tailnet interface, not a public interface. Restrict access in the Tailnet policy if needed. After editing `gallery.html`, copy it to `design-gallery/index.html` or recapture.

## Proposal regression comparison

Before the module migration, preserve the accepted proposal's `design-gallery/after/` directory separately. After capturing the finished implementation:

```sh
export PNGJS_MODULE=/tmp/fernblick-design-tools/node_modules/pngjs/lib/png.js
export PIXELMATCH_MODULE=/tmp/fernblick-design-tools/node_modules/pixelmatch/index.js
node tools/design/compare.mjs /path/to/preserved-proposal/after
```

The comparison writes `design-gallery/proposal-comparison.json` and fails if more than 0.05% of pixels change in any screenshot (pixelmatch color threshold 0.1, excluding anti-aliasing). Do not refresh the reference to conceal regressions. All 156 module-migrated captures match the accepted proposal; no screenshots exceed the threshold, and all have zero perceptually changed pixels under these settings.

## Validation

- `npm run check`: formatting, CSS Modules conventions, lint, TypeScript, 70 tests and production build. Includes a real loopback HTTP test for the locally bundled font and full license, without any live-agent socket access.
- `npm run build:storybook`: builds component stories and copies the font license into the output.
- `verify.mjs`: Chromium and WebKit at 320, 390, 768, 834, 1024 and 1440px. Checks all 52 three-viewport screen groups (156 screenshot cards), image decode, comparison/finished/zoom modes, search and device filters, keyboard navigation and close, before-only gallery, actual Manrope loading and the shipped license, responsive rail visibility, long-title console hit targets, red error icons, centered empty chat, back navigation, no page errors and no document-level horizontal overflow.
- Visual review of phone overview/conversation/forms and iPad/desktop conversation captures.

Remaining limitation: these are synthetic-data browser captures, not testing against a live backend or physical iPad/phone. No production deployment or integration into `main` has been performed.
