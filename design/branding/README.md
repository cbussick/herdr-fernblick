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

These are **raster assets**, not vectors. Do not wrap the PNG in SVG and call it a
vector master. The master preserves the selected silhouette and illustration;
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

## Usage

- Navigation pairs the transparent head with the playful wordmark, exported as a
  transparent 564×126 PNG and displayed at up to 128 CSS pixels wide. A visually
  hidden “Fernblick” label preserves its level-one heading for assistive technology;
  both brand images are decorative. The text image scales down in narrow sidebars
  without squeezing the head or overlapping connection status. It is artwork,
  not a font substitution: tabs, buttons, chat and other headings keep Manrope.
- The empty desk uses the transparent head next to ordinary UI text.
- The first pending dashboard request shows the full logo and “Loading agents…”.
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
