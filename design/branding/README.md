# Scout branding

Approved direction: **Scout Light with the original playful lowercase lettering**.
The sheep wears binoculars and looks sideways. The wordmark is part of the approved
artwork, not Manrope and not an installed font. Manrope remains the interface font.

## Sources and exports

- `scout-light-approved.png`: original native image-generation output selected by
  the user in the logo exploration; retained unchanged. SHA-256 is recorded below.
- `scout-head-master.png`: transparent, square 800×800 raster master, no lettering.
- `scout-logo-master.png`: transparent 940×990 raster master with the playful wordmark.
- `scout-wordmark-master.png`: transparent 940×210 crop of the approved lettering only.
- `../../public/icons/`: small runtime exports; see its README for sizes and use.

The approved masters above are **raster assets**, not vectors. Do not wrap the PNG
in SVG and call it a vector master. The master preserves the selected silhouette and illustration;
background removal and edge unmatting make it usable on different surfaces.

Approved-source SHA-256:
`035b3a83b104ca95369f448a89364234848f139b103703ea3084f3cef6b6803f`.

The solid icon background is the navigation color `#e7f2fc`. The logo follows the
app's white/pale-blue/blue/navy palette; wordmark ink is `#17374f`. The approved
image's subtle raster shades are retained in the mascot, not claimed to be exact
flat CSS colors. Semantic status colors in the interface are unchanged.

## Reproduce

The export tool needs Sharp only for artwork preparation, not at app runtime or
for a normal build. Install it separately, as with the screenshot tools:

```sh
npm install --prefix /tmp/fernblick-brand-tools sharp@0.34.5
SHARP_MODULE=/tmp/fernblick-brand-tools/node_modules/sharp/lib/index.js \
  node tools/branding/export-scout.mjs
```

Run from the task worktree. All source images needed by the export are checked in;
there is no dependency on the original temporary generation directory or an image
model. The script removes the connected background, unmattes the edges/lettering,
preserves the enclosed pale lens and ear colors, crops masters, and exports PNGs.
It verifies the maskable artwork fits inside the central 80%-diameter safe circle.

## Vector UI artwork

`public/icons/scout-logo.svg` is a genuine, flat-color vector trace of the full
logo master, including the original custom lettering. It contains paths and two
separate pupil ellipses, not embedded raster artwork. The vector artwork is used
for in-app loading, the navigation head/wordmark and the empty-desk head. It uses
flat colors instead of the original's subtle texture and shading. Raster masters
are preserved; installed-app icons and favicons remain PNGs.

The same exporter writes `public/icons/scout-head.svg` and `scout-wordmark.svg`
using the approved header crops and padding. These are static: animation belongs
only on the initial loading screen.

`src/shared/ui/ScoutLogo.tsx` renders the same generated paths inline, with unique
per-instance outer-goggle clipping masks. A foreground blue rim covers the pupils
at the eye openings: do not clip pupils against a separately painted white eye
edge, which double-antialiases the boundary and produces a pale fringe.
Its optional `animated` prop moves only the pupils; the default pose looks right. Reduced motion keeps that static pose.
`LoadingBrand.tsx` shares the animated SVG and whole-label opacity pulse between
the real app and Storybook. The pupils start looking right and immediately begin
a slow 1.2s glance left, hold left for 0.8s, then return right over 1.2s. They rest
right for the remaining 4.8s of each 8s loop, without pausing at center. Starting
the first glance immediately keeps movement visible during short loads.
The label breathes
between 1 and 0.6 opacity over 3.2s. Reduced motion disables both. Loading ends
immediately when the dashboard request settles; there is no minimum splash timer.
The Storybook `Branding/Loading preview` stories show the animation and comparison.

Reproduce with preparation-only tools (do not add them to runtime dependencies):

```sh
npm install --prefix /tmp/fernblick-vector-tools sharp@0.34.5 potrace@2.1.8
SHARP_MODULE=/tmp/fernblick-vector-tools/node_modules/sharp/lib/index.js \
POTRACE_MODULE=/tmp/fernblick-vector-tools/node_modules/potrace/lib/index.js \
  node tools/branding/vectorize-scout.mjs
npx oxfmt --write src/shared/ui/scoutArtwork.ts
SHARP_MODULE=/tmp/fernblick-vector-tools/node_modules/sharp/lib/index.js \
  node tools/branding/verify-scout.mjs
```

Run from the task worktree. The tool quantizes the approved PNG into flat-color
masks, traces their contours, and separates the eye interiors from the pupils.
The masks overlap: fleece backs the whole head, navy continues under the goggles,
and blue continues under the eyes. Do not return to adjacent cut-out layers;
independently fitted and antialiased edges create pale seams. The verification
tool checks for internal transparency across the goggles at 2× resolution and
white contamination at the resting pupil/goggle boundaries at 4× resolution.
The exporter writes the three standalone SVGs and `src/shared/ui/scoutArtwork.ts`; do not edit
generated paths independently. The script's eye segmentation and pupil geometry
are specific to this approved master, not a general image vectorizer.

## Usage

- Navigation pairs the transparent head with the playful wordmark, exported as a
  transparent SVG and displayed at up to 128 CSS pixels wide. A visually
  hidden “Fernblick” label preserves its level-one heading for assistive technology;
  both brand images are decorative. The text image scales down in narrow sidebars
  without squeezing the head or overlapping connection status. It is artwork,
  not a font substitution: tabs, buttons, chat and other headings keep Manrope.
- The empty desk uses the transparent head next to ordinary UI text.
- The first pending dashboard request shows the animated vector logo and a softly
  pulsing “Loading agents…” label.
  It disappears when that request finishes: no branding timer or minimum duration.
  Offline/error states retain their existing explanation and recovery controls.
- Installed-app and Apple icons have an opaque background, no baked-in rounded
  corners or wordmark. The OS supplies its own mask.
- System launch/splash behavior is platform-controlled, using the manifest icon
  and background where supported. It is not a promise of a custom iOS launch image.
- The full logo belongs on in-app loading/branding surfaces, not tiny favicons.

Icon filenames changed from the horizon set to help browsers detect the branding
update. PWA identity (`id`, scope, start URL) stays unchanged. Existing installations
may refresh their home-screen icon later than the web app; some platforms may
require reinstalling the shortcut. No user data or chat state is migrated.
