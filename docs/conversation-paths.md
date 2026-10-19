# Conversation paths for long sessions

## Behavior

The dialog opens a window ending at the current visible message, with at most 50
rows. **Load earlier** and **Load later** replace the window rather than growing
an unbounded DOM. The count states which portion is shown. Only the actual leaf,
not every ancestor on its active path, is marked **Current point**.

Messages form a flat list. **N branches** opens the immediate alternatives at a
fork, even when hidden tool/extension entries separate their visible messages.
**View path** shows the chosen alternative with its ancestors and a continuation
(preferring the active child, otherwise the last appended child). Further forks
remain explicit controls. **View continuation** exposes an abandoned future even
when there is only one child after the current leaf. Separate root paths are
available through **Starting paths**. **Current path** returns to active history.
These operations only browse; none changes Pi's leaf or invokes a model.

Search, **Your prompts**, and **Labels** cover all visible user/assistant messages
across all branches. Matching uses full text and labels, including text beyond
the preview. Results are paged too. Clear search/filters or choose **View path**
to return to path browsing. Typing is debounced for 300 ms; a superseded query is
not permitted to replace newer results. The browser finishes one read before
starting another because aborting fetch does not cancel the bridge operation.

Rows contain at most 240 characters of message text, with an ellipsis when
truncated. **Edit and branch** retrieves the full original prompt and available
image IDs through the existing navigation handler. It never uses preview text
as a prompt, never sends automatically, and retains the previous branch. The
existing 32,000-character restoration limit remains; oversized prompts fail
explicitly instead of being silently clipped. Assistant navigation continues
after the chosen response and does not replace a draft.

## Wire and module boundary

- `packages/pi-live-chat/treeProtocol.ts`: bounded request/flat page schemas.
- `packages/pi-live-chat/treePage.ts`: iterative indexing, branch browsing,
  full-text matching, revision checking and page construction.
- `POST /api/agents/:pane/tree-page`: `{target,page}`; replies with correlated
  `{type:"tree-page",id,target,page}` over the existing private bridge.
- The optional `treePages: true` snapshot capability gates new commands. Older
  extensions receive a `/reload` message before any unsupported wire command.
- The legacy `/tree` and `tree` command remain unchanged for older clients. New
  browsing never calls them or their recursive projection.

The request's `page` accepts `query` (up to 256 characters), `filter`
(`all`, `user`, `labels`), optional `focusId` for an explored path,
`branchesOf` for alternatives (`null` means root alternatives), and optional
`offset`/`revision` for paging. Search/filter mode takes precedence over branch
browsing. A new scope starts without an offset or revision.

A revision identifies the append-only entry count, last entry ID and current
leaf. Paging requires that revision. New history or metadata invalidates offsets
rather than silently shifting results; **Refresh paths** clears the old cursor.
Navigation separately revalidates the captured runtime/session/epoch and selected
entry as before. Labels, full prompts and images remain authoritative in Pi.

Responses have at most 50 rows and 128 KiB of page data. Byte-heavy pages return
fewer rows with correct follow-up offsets. An initial window retains the focused
message when shortened. IDs, labels, timestamps and previews have schema bounds;
page boundaries and unique row IDs are validated. No raw-depth or raw-entry-count
cutoff is applied to the new reader. Indexing is linear and iterative, holds
references and short previews, and rejects malformed duplicate/cyclic ancestry.
Search visits the complete in-memory session on each request; it does not read
JSONL or introduce a persistent transcript index/cache.

The desktop/tablet/phone layout has no growing indentation or horizontal tree
scroll. Short-height layouts condense the header and keep errors in a single
scroll region rather than clipping a centered error inside another scroll area.

## Verification

```sh
npm test -- packages/pi-live-chat/treePage.test.ts \
  src/features/agents/ConversationTreeDialog.test.tsx \
  src/shared/api/apiClient.treePage.test.ts server/pi/liveBridge.test.ts
npm test -- packages/pi-live-chat/extension.test.ts -t 'restores a root prompt through real Pi'
npm run check
```

Fixtures cover a 354-message chain with hidden entries, 10,000-message history,
all-page reachability, hidden branches, labels, image-only messages, matches past
preview boundaries, byte budgets, stale revisions, malformed ancestry, capability
and Origin guards, response identity checks, query supersession, errors/cancel,
and full prompt restoration through real Pi despite extension metadata hooks.

The browser fixture uses the actual page reader and actual production frontend,
with synthetic HTTP/SSE and an in-memory SessionManager. It does not control an
existing agent, invoke a model or expose private history:

```sh
npm run build
python3 -m http.server 5208 --bind 127.0.0.1 --directory dist
# Another terminal in this worktree:
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs \
  node --import tsx tools/design/tree-pages.mjs http://127.0.0.1:5208
```

Chromium and WebKit cover small-phone, phone, keyboard-height, iPad and desktop
viewports. Optional `TREE_ENGINE`/`TREE_DEVICE` select one case. Screenshots and
JSON results are in ignored `design-gallery/tree-pages/`. Keyboard height is
simulated; physical-device keyboard behavior still needs manual verification.

A read-only replay of the reported 1,759-entry saved tree returned 50 rows in a
16,820-byte initial page, found all 145 user prompts, and read the previous page.
Three queries completed in about 28 ms on the development host. The source file
was not changed. This verifies its data shape, not a deployed live session.
