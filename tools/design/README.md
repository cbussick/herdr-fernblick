# Blue command desk

Design proposal for Fernblick, isolated on `design/blue-responsive`. The running production app is unchanged. Review gallery: <http://100.71.229.1:5197/> (same Tailnet required).

## Direction

Fernblick is a remote view onto coding agents, not an analytics dashboard. Its visual anchor is a small horizon/window mark and a pale-blue workspace rail. Keep the conversation quiet and readable; make the agent's status and the next action easy to find.

- Palette: sky/navigation `#e7f2fc`, mist/canvas `#f5f9fd`, white/surface `#ffffff`, navy/text `#17374f`, blue/action `#14669f`, pale blue/selection `#dceefc`. Keep distinct semantic warning, danger and success colors.
- Type: locally hosted Manrope variable for the interface; the existing monospace stack for terminal output and Pi session metadata. The font's OFL license is included in `src/styles/fonts/`.
- Phone: one pane at a time, left-aligned workspace grouping, a reachable labeled Create control, and two header rows so status never competes with edit/view controls.
- iPad: persistent 18rem workspace rail starting at 768px, with names and statuses on separate lines; conversation remains the primary surface.
- Desktop: rail plus a bounded conversation column, a one-row console header from 1152px, and a bounded composer instead of a viewport-wide input.
- Grouping: workspace containers correspond to actual projects, not arbitrary dashboard cards. The flat agent view stays a list. Distinct chat corners communicate speaker, not decoration.
- Accessibility: 44px console touch targets, visible focus, improved secondary-text contrast, safe-area padding and existing reduced-motion support. No new animation.

The plan deliberately avoids metrics tiles, a decorative gradient hero, and dashboard ornament. A subtle blue rail and the horizon mark carry the personality; status color retains its operational meaning.

## Captures

43 screens/states at each of these sizes:

| Device        | CSS pixels  |
| ------------- | ----------- |
| Phone         | 390 × 844   |
| iPad portrait | 834 × 1194  |
| Desktop       | 1440 × 1000 |

129 baseline screenshots and 129 proposal screenshots are grouped into 129 before/after comparisons. Includes overview/search/empty states, create menu and forms, conversation/status/tool/images/composer, terminals, edit/restart/close/context actions, conversation paths and filters, loading and recovery states. These are the reachable screens and representative state variants, not every possible combination of arbitrary content and errors.

`capture.mjs` renders the actual app, drives its controls, intercepts **all** `/api/` traffic and replaces EventSource with deterministic fixtures. It never uses the real Herdr socket, launches an agent, sends a real prompt, or exposes private session content. Baseline is commit `2695548`. Baseline phone header controls overlap; baseline-only synthetic click dispatch permits capture of the obscured screens. Proposal controls are exercised with normal pointer clicks.

Generated images, manifests and the served HTML are in ignored `design-gallery/`. The gallery supports viewport/search filters, side-by-side lightboxes, after-only inspection, native-resolution zoom, previous/next buttons, arrow keys and Escape. Before-only gallery: <http://100.71.229.1:5197/?phase=before>.

## Reproduce

Install browser tooling separately from app dependencies:

```sh
npm install --prefix /tmp/fernblick-design-tools playwright
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

## Validation

- `npm run check`: formatting, lint, TypeScript, tests and production build.
- `verify.mjs`: Chromium and WebKit at 320, 390, 768, 834, 1024 and 1440px. Checks gallery image decode, comparison/after-only/zoom modes, search and device filters, keyboard navigation and close, before-only gallery, responsive rail visibility, long-title console hit targets, back navigation, no page errors and no document-level horizontal overflow.
- Visual review of phone overview/conversation/forms and iPad/desktop conversation captures.

Remaining limitation: these are synthetic-data browser captures, not testing against a live backend or physical iPad/phone. No production deployment or integration into `main` has been performed.
