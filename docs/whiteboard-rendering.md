# On-demand whiteboard rendering

`BoardRenderer` (`server/boards/renderer.ts`) exports the **current native scene** as a PNG on demand, without an open editor or a connected browser. It uses the pinned Excalidraw 0.18.1 `restoreElements` / `exportToBlob` implementation in headless Chromium, not a simplified shape renderer. Native freehand paths/pressure, frames, text, rotation, bindings, and inline raster assets follow the same export path as Excalidraw. Fonts and their vendor fallback are served locally, as in the editor.

## Installation and deployment

Playwright is a pinned **production dependency**. Browser binaries and Linux shared libraries are separate from `npm ci`:

```sh
npm ci
npx playwright install --with-deps chromium
npm run build
```

Install the browser as the same OS user that runs the backend, or set `PLAYWRIGHT_BROWSERS_PATH` consistently during installation and service startup. In an image with preinstalled OS libraries, `npx playwright install chromium` is sufficient. Do not rely on the developer's external `PLAYWRIGHT_MODULE` paths, another project's dependencies, or an unrelated Chromium cache revision. Reinstall Chromium after changing the Playwright pin. A missing binary/library causes the read to fail; there is no stale screenshot fallback.

Ship `dist/whiteboard-render.html`, all `dist/assets/` chunks, and `dist/excalidraw/fonts/` with the usual frontend build. Keep the bundled font licenses. The renderer origin must serve that build; **the Vite development server is intentionally not supported** by the narrow asset allowlist. In a development backend, first build and serve the built frontend at the renderer's origin. The dedicated page is not an editor and never contacts board APIs.

## Runtime contract

```ts
const renderer = new BoardRenderer("http://127.0.0.1:8787");
const png: Buffer = await renderer.render(validatedCurrentScene);
await renderer.close();
```

Use the actual listening backend origin (no trailing slash/path/credentials), or an isolated static origin serving the same build. Construction does not start Chromium or make requests. Call `render` only after the HTTP listener is accepting requests; never await a render as part of starting that listener. Call `close` during shutdown; it rejects queued/active calls and waits for browser cleanup. Closing is idempotent, and further renders reject.

Each render validates/detaches its input, launches a fresh browser, creates a private context, loads the dedicated entry, sends JSON as data via Playwright, exports a PNG, and closes the browser even on failure. There is no browser process while idle and no cookies, service worker, or scene cache carried between requests. Startup overhead is intentional isolation; requests are serialized, with at most four active-plus-waiting calls. Excess requests fail immediately. A 30-second deadline includes queue time, navigation, decoding, and export. Timeout/shutdown closes Chromium to interrupt even CPU-bound page code. Browser launch has its own ten-second timeout.

PNG output is at most **2 MiB**, with a maximum side of 2048 pixels and at most 2,097,152 pixels. Large scenes fit proportionally rather than cropping to a viewport. High-entropy output is progressively downscaled until it fits the byte limit; extremely wide scenes can necessarily lose fine detail. The PNG does not embed the original scene or its assets. Decoded referenced raster assets are limited to a cumulative 32 megapixels. Corrupt images and failed local font loads fail the render rather than silently substituting placeholders. System glyph fallbacks (including emoji) remain OS-dependent, just as in the editor.

The runtime caller remains responsible for fresh authorization/revision checks and framing the PNG in a socket response. A 2 MiB PNG becomes about 2.67 MiB as base64, leaving space under the 4 MiB socket JSON frame limit. A render error must be reported explicitly, never satisfied using an old stored snapshot.

## Untrusted-scene boundary

The entry accepts validated JSON only, never script, markup, URLs to navigate to, or agent-provided export options. Browser requests are denied by default. Only the initial dedicated HTML document, same-origin built `/assets/*.js` scripts, and `/excalidraw/fonts/**/*.woff2` fonts are allowed. External origins, redirects/navigation after the initial document, APIs, uploads, arbitrary same-origin paths, non-GET requests, query-bearing asset requests, and WebSockets are blocked. Service workers and downloads are disabled; popups are closed. The page also has a restrictive CSP. Inline raster assets use only the board's validated raster data URLs; SVG assets are not accepted.

This is defense in depth around a native renderer, **not an OS security sandbox**. Playwright's default Chromium launch configuration is used; run the backend as an unprivileged OS user and apply container/process memory limits for hostile workloads. Image decoding and native Excalidraw geometry work can consume memory before the decoded-pixel check or timeout can stop them. The scene input limits still apply. Do not expose arbitrary renderer origins or the renderer API to unauthenticated callers.

## Verification

```sh
npx vitest run server/boards/renderer.test.ts server/boards/renderer.integration.test.ts
npm run typecheck
npm run build
```

The integration tests require the matching installed Chromium. They build a dedicated entry into a temporary directory, serve it on an ephemeral loopback port, render through the real `BoardRenderer`, inspect PNG pixels, and delete their fixture/browser/server resources. They do not contact Herdr, a live backend, a user board, or an agent. Coverage includes native shape types, pressure freehand, raster pixels, all native font-family choices and local CJK fallback, deleted elements, empty/current scenes, huge bounds, PNG byte downscaling, missing-font/corrupt-image failure, real shutdown, and external/API/redirect blocking even without the entry CSP. Unit tests cover queue/concurrency limits, total deadlines, shutdown/late launch cleanup, page failures, input detachment, output limits and request interception.

If a highly parallel full-suite run times out in an unrelated large-upload socket test under browser/build load, rerun with `npm test -- --maxWorkers=2`. This limits test-process contention without changing production renderer concurrency.
