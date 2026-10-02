# Chat annotations (HER-6)

## Interaction

Turn on **Annotate** above the conversation. Select text within one assistant response to open a comment popover. Enter adds it to the pending tray; Shift+Enter inserts a newline and Escape cancels. Touch selection opens the popover without stealing focus from the selection handles: tap its field to type. **Comment on response** is a keyboard/touch alternative for quoting an entire reply.

Saved passages get a pale-violet underline/highlight. The tray above the ordinary composer shows the pending count and latest comment; expand it to review, edit or remove comments. **Send comments** immediately forwards one prompt containing each original passage, its response ID/character offsets, and its comment. It does not fill, send, upload or clear the ordinary text/image draft.

Turning the mode off leaves pending comments available to send. Switching to Terminal and back also retains them. Like the existing composer, annotations are held in the mounted conversation view, not persisted: leaving the agent or reloading the page loses unsent comments.

## Design

An explicit toggle keeps copying text in ordinary chat unchanged. This is an inline review, not a second full-screen editor: the passage stays visible, the comment sits nearby, and only the batch occupies the composer boundary. Existing Manrope and the blue/white conversation layout stay intact (`#f5f9fd` canvas, `#ffffff` surface, `#17374f` text). Violet ink `#514593`, highlight `#eeebfc`, and border `#c9c1ea` distinguish unsent review work from ordinary blue messages. No decorative animation or new font/dependency.

Plannotator's installed `anchorMessageFeedback` was the reference for pairing a quoted older assistant response with user feedback. Fernblick uses its existing guarded prompt endpoint, not Plannotator's extension transport or session fallback.

## Boundaries

- Only assistant response text is selectable for annotation: no user messages, thinking, tools, speaker labels, or cross-message ranges. Links and overlapping highlights preserve the original text and offsets.
- The combined prompt, including headers and quotes, must fit the existing 32,000-character limit. Nothing is silently truncated.
- Comments can be collected while the agent works. Sending requires the same idle, connected, current-protocol state as an ordinary prompt. There is no automatic queue or retry.
- The batch captures the runtime/session/epoch. A changed session or conversation path retains the visible comments but blocks sending them to the replacement; discard the old batch to start another. Live text changes do not relocate a highlight onto a different matching passage.
- Only an acknowledged forwarding clears the submitted batch. Failed/uncertain forwarding retains it with a check-Pi-before-retrying warning. An ACK is not a Pi receipt.
- Annotation sending shares the existing submission lock with the ordinary composer and conversation navigation.

## Verification

```sh
npm run check
PLAYWRIGHT_MODULE=/tmp/fernblick-design-tools/node_modules/playwright/index.mjs \
  node tools/design/verify-annotations.mjs http://100.71.229.1:5186
```

The browser script intercepts all API traffic and replaces SSE with synthetic fixtures; it never commands existing agents. Chromium and WebKit run phone (390×844), portrait iPad (834×1194), and desktop (1440×1000) flows. It covers mode-off selection, assistant-only selection, cross-message rejection, touch focus, highlights across links, Enter/Shift+Enter/IME/Escape, editing/removing, mode/Terminal switching, idle/protocol/connection gates, direct sending, failure retention, no automatic retry, in-flight locking, ordinary text/image preservation, and epoch replacement. Screenshots go to ignored `design-gallery/annotations/`.

Unit tests cover prompt serialization, repeated/mutated quote anchors, overlapping link highlights and escaping, viewport placement, comment limits, editing, in-flight state and runtime/session/epoch ownership. Physical mobile selection handles and the software keyboard still warrant hands-on testing.

## Local review server

The HER-6 frontend preview binds **only** to the Tailnet interface on port 5186. Its ignored Vite config is `node_modules/.cache/annotation-preview.mts`; the process log is `/tmp/fernblick-her-6-vite.log` and its PID record is `/tmp/fernblick-her-6-vite.pid`.

It proxies `/api` to the already-running backend at `http://100.71.229.1:8787`. This intentionally shows and controls the **existing agents**; it is not an isolated agent stack. No second backend or Pi socket is started. Browser verification uses fixtures instead. Keep the preview private with the existing Tailnet access policy.
