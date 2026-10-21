# Fernblick — Scout icons

Generated from the approved Scout Light artwork, with the original playful
lettering. Source masters, provenance and regeneration instructions live in
[`design/branding/README.md`](../../design/branding/README.md).

| Asset                    | Size    | Background  | Use                                         |
| ------------------------ | ------- | ----------- | ------------------------------------------- |
| `scout-head.png`         | 256×256 | Transparent | Navigation and empty desk                   |
| `scout-logo.png`         | 564×594 | Transparent | Loading screen; sheep + wordmark            |
| `scout-wordmark.png`     | 564×126 | Transparent | Playful lettering in the navigation heading |
| `scout-favicon-16.png`   | 16×16   | Pale blue   | Small browser favicon                       |
| `scout-favicon-32.png`   | 32×32   | Pale blue   | Browser favicon                             |
| `scout-icon-192.png`     | 192×192 | Pale blue   | PWA icon, any-purpose                       |
| `scout-icon-512.png`     | 512×512 | Pale blue   | PWA icon, any-purpose                       |
| `scout-maskable-512.png` | 512×512 | Pale blue   | PWA maskable icon with extra safe padding   |
| `scout-apple-touch.png`  | 180×180 | Pale blue   | iOS home-screen icon                        |

Solid backgrounds use `#e7f2fc`. The OS chooses the icon mask; no rounded corners
are baked into these square assets. The entire maskable sheep lies within the
central 80%-diameter safe circle. Favicons use the head at the largest practical
size; the tiny lettering is never included.

All runtime files are precached with the application shell. These are shipped
branding assets, not generated chat images or user attachments.
