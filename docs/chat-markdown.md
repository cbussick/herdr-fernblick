# Chat Markdown

Ordinary user, assistant and thinking messages share `ChatMessageText`. Messages remain raw Markdown in the protocol/session; only the display is formatted. Tool output remains literal in its existing disclosure.

## Supported

- Bold and italic emphasis, including nested formatting.
- Inline code and HTTP/HTTPS links, bare web URLs and URL wikilinks with optional aliases.
- ATX (`#`) and Setext headings.
- Ordered lists (preserving the starting number), unordered lists and nested lists.
- Blockquotes, including multiple paragraphs and nested blocks.
- Backtick/tilde fenced code blocks, including incomplete streaming fences; indented code also uses the code-block presentation. An optional language label is displayed as text, not executed. Syntax highlighting is not enabled.
- GFM tables with header cells, inline formatting and column alignment. Tables and long code lines scroll within the message rather than widening the page; their scroll areas are keyboard focusable.
- GFM task lists with disabled checked/unchecked checkboxes. They reflect the message, not editable task state.
- Paragraphs, original soft line breaks and explicit hard breaks.

Raw HTML, Markdown images, reference-style links, vault-note wikilinks, strikethrough and horizontal-rule syntax remain literal. Image attachments retain their separate existing presentation. Generated annotation-feedback prompts intentionally preserve original quoted passages and comments literally, formatting only their comment labels.

## Copying and safety

Each code block has a keyboard-accessible copy button. It copies the parser's code payload, including indentation and blank lines, without fences, the language label, toolbar text or annotation controls. Success and failure are announced; failures offer retry and manual selection. If the payload changes during streaming, an old success indication is not shown for the new payload.

The Clipboard API is preferred. An HTTP-compatible textarea/`execCommand` fallback handles deployments on non-secure tailnet URLs and restores the prior focus/selection. Browser policy may still prevent copying; the UI does not claim success on failure. Physical iPadOS clipboard behavior requires device testing.

Raw HTML is never injected. Only HTTP/HTTPS destinations become links, opened with `noopener noreferrer`. Code and unresolved/unsafe link syntax do not become navigable links. No external Markdown images are fetched.

## Annotation source mapping

`chatMessageFormatting.ts` parses once with CommonMark plus only the GFM table/task-list extensions. Parser tokens identify list/quote/indent prefixes; every visible or hidden leaf retains an exact raw-source interval. Syntax spans are hidden from display/accessibility/native copying but remain in assistant source DOM text. List and table separators are placed inside legal list-item/table-cell descendants, preserving both valid nesting and source order.

`readAnnotationSelection` reads cloned range text after removing `data-message-control` descendants. This excludes code language/copy/status text from both prefix offsets and quoted passages, while retaining hidden Markdown syntax. Control endpoints, cross-message selections and non-assistant selections remain invalid. Cross-block annotations contain the original Markdown slice, not a reconstructed rendering.

Tests cover raw-source coverage, every streaming prefix of a mixed block fixture, nested container formatting, safe destinations, exact code copying, failure/fallback behavior and cross-block selection/highlights. The synthetic Chromium/WebKit annotation script exercises phone, portrait/landscape iPad and desktop sizes with all agent APIs intercepted:

```sh
PLAYWRIGHT_MODULE=/tmp/fernblick-design-tools/node_modules/playwright/index.mjs \
  node tools/design/verify-annotations.mjs http://127.0.0.1:<static-preview-port>
```

See [annotation mode](annotation-mode.md) for the surrounding comment workflow.
