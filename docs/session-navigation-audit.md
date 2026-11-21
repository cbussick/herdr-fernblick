# Session navigation audit and fixes

Audited baseline: `d2854f0`. **All ten findings and the additional history-helper invariant were fixed in `6de7a65`, merged into `main`, pushed, and deployed as `c082747`.** The implementation and original audit branches/worktrees have been cleaned up. The baseline reproduction details below are historical; their old line numbers refer to the audited commit, not the current implementation. Verification did not close, restart, resume, or send prompts to real agents.

## Summary

Ten user-visible cases were reproduced in both Chromium and WebKit with the actual frontend and synthetic HTTP/SSE. The same scenarios now pass as fixed-behavior acceptance tests, alongside the cross-session history invariant and additional lifecycle/authority regressions.

On the audited baseline, the problems shared four causes:

1. A fresh agent is a local overlay over an unrelated URL, rather than a navigation destination.
2. Board return history stores an unscoped numeric index, not a validated conversation destination.
3. Component mounting/lifetime follows temporary agent availability rather than the conversation's lifetime.
4. Async mutations retain navigation authority after their initiating dialog/selection has gone away.

## Implemented changes

- **N1/N3/N4/N6:** Removed the local pending-agent overlay. Unsaved agents have `/panes/:paneId/chat|terminal|whiteboard` destinations, including service-worker navigation support. Only persisted dashboard metadata promotes them to session URLs, preserving the mounted composer and current mode. View changes retain the selected route's identity. A pane conversation pins its first live session; replacements cannot inherit its board or commands. Confirmed runtime/epoch changes retire a board instead of reopening it.
- **N2/N9:** Board return markers are scoped to pane/session identity and must point to an older entry. Promotion and direct links without a valid return replace the board with chat. No zero-delta reloads or cross-conversation returns.
- **N5:** Keep only the selected conversation's console mounted but suspended during inactive polls. Text, attachments and focus state survive. Retained data is not live-agent authority: SSE is suspended, the console renders no controls, and re-enable requires a fresh baseline before commands become available. Explicitly selecting another saved conversation, even in the same pane, starts a separate composer lifetime. Moving/resuming the same saved conversation into another pane or workspace retains its draft.
- **N7/N8/N10:** Tab-close completion navigates only if the selected tab is still the closed tab (including sibling panes). Create/new-tab completion always updates data but navigates only while its original dialog and history entry still own that intent. Unmount, dismiss/reopen, and navigation revoke it permanently; Back/Forward returning to the original URL cannot revive that permission. History-list resumes likewise check their initiating destination. New shells are cached before selection and use terminal URLs.
- An unsaved Pi exit/replacement by a shell or another CLI retires the selection rather than handing its Pi draft to a shell input. Ordinary shell-to-Pi startup draft preservation remains covered.

## Historical baseline findings

### N1 — Fresh-agent selection can disagree with the URL and ignore navigation (high)

**Reproduce:** Open saved A, select fresh unsaved B, then select A again. The address remains `/sessions/A/chat`, but B stays on screen. Refresh opens A instead of B. From overview, opening fresh B leaves `/` in the address; refreshing returns to overview. Browser Back between chat/terminal entries of A also fails to clear B's temporary selection.

**Cause:** `App.tsx:43–52,105–128` keeps `pendingPaneId` outside the router. Clicking a saved agent relies on a later session/pane parameter change to clear it. Selecting the session already in the address, or changing only its mode/history entry, changes neither dependency. Drafts in the unmounted local view are not reload-persistent.

**Evidence:** App integration assertions fail for both selecting A and browser Back. Actual browser fixtures confirm the wrong displayed conversation and refresh behavior. Phone/tablet fixtures also confirm fresh B returning to overview after reload.

**Fix direction:** Give an unsaved Pi conversation an explicit pane-based destination and view, then replace that destination only when a session URL is resolvable. Clear the old temporary selection explicitly when selecting a different destination; do not depend only on parameter-change effects.

### N2 — Fresh-board promotion can make Back reload the board instead of closing it (high)

**Reproduce:** View A's chat, open fresh B, open B's board, then let saved metadata for B arrive. The address becomes `/sessions/B/whiteboard`. Press the board's Back button. The same board reloads instead of returning to B's chat.

**Cause:** Promotion replaces the current history entry, but `usePaneNavigation.ts:28–48` records the replaced entry's own index as `fernblickChatIndex`. Closing calculates a zero delta. `history.go(0)` reloads in actual browsers (and is only a no-op in memory history).

**Evidence:** Both App integration and helper tests fail; Chromium and WebKit reproduce the same-URL reload.

**Fix direction:** Store a session-scoped return destination. Never call `history.go(0)`, never return to a replaced entry, and navigate/replace with B's chat when no valid older B-chat entry exists.

### N3 — Direct pane links still promote an unsaved ID to an unavailable session URL (high)

**Reproduce:** Open `/panes/B/chat` for a fresh Pi agent. SSE reports its in-memory session ID before a session file exists. The page changes to `/sessions/B/chat`; session lookup/polling returns no agent/chat and the conversation disappears behind “Conversation or pane unavailable.”

**Cause:** `App.tsx:291–305` canonicalizes `onSession(id)` whenever there is no route session or pending selection, without checking persistence. The earlier whiteboard fix guards the pending-agent path, not this direct-pane path.

**Evidence:** Integration assertion detects premature canonicalization. Both browser engines reproduce the unavailable screen with a valid synthetic live conversation.

**Fix direction:** Use one persistence-aware promotion path for normal selection, direct pane links, mode changes, and newly created/resumed agents. An in-memory ID alone is insufficient.

### N4 — Switching to terminal before SSE readiness drops the pinned session identity (high)

**Reproduce:** Open `/sessions/A/chat`, delay the first live snapshot, and press Terminal. The address changes to `/panes/P/terminal` instead of `/sessions/A/terminal`.

**Cause:** `AgentConsole.tsx:145–148` sends `snapshot?.identity.sessionId`; `App.tsx:308–317` falls back to pane navigation if that argument is absent, even when a valid route session already exists. This also removes `expectedSessionId`, bypassing the session-pinned terminal readiness/mismatch guard for that transition.

**Evidence:** Integration and real-browser fixtures reproduce the wrong route. Confirmed at desktop, phone and portrait-tablet widths in both engines. The opposite direction, terminal-to-chat before its first snapshot, is correctly blocked by the terminal guard and is **not** reported as a reachable failure.

**Fix direction:** Prefer the pinned route identity for same-conversation view changes. Preserve identity verification until live state confirms the selected conversation; do not downgrade a session route to a pane route merely because SSE is connecting.

### N5 — A successful inactive poll during restart destroys the draft (high)

**Reproduce:** Type a draft in A, let session lookup temporarily return `{ agent: null, chat: A }`, then return the same agent/session. A's URL stays unchanged, but the restored composer is empty.

**Why the window is real:** `HerdrService.changePiSession` waits for the old process to disappear, then delays 150 ms before starting the replacement. `getSession` has bounded startup tracking for resumed sessions, but no equivalent restart tracking. A session poll can observe this gap or delayed replacement metadata. Not every restart will catch the window.

**Cause:** `App.tsx:94–101,285–323` unmounts the entire `AgentConsole` on a successful null-agent lookup. Draft/attachments are held inside that component. Transport errors retain cached data, but a temporary successful inactive result does not.

**Evidence:** Integration test and both browsers reproduce draft loss with the exact active → inactive → same-session-active response sequence, including phone/tablet widths. No live restart was executed.

**Fix direction:** Keep conversation-scoped drafts outside the availability-dependent console, and represent restart/startup explicitly. Do not permanently mask genuine exits or pane reuse with cached live-agent data.

### N6 — A pending routed board silently follows a replacement conversation (high)

**Reproduce:** Open fresh B's board while it is still a local pending view; publish a new live conversation C in the same pane. The old board is retired, then C's board opens automatically without an explicit user selection. The address still points to the underlying A chat (or overview).

**Cause:** `AgentConsole.tsx:166–170,214–220` clears a mismatched board target, then its routed-view effect immediately creates a new target because `routeView` remains `whiteboard`. Pending sessions have no `expectedSessionId`, so the saved-session mismatch protection does not apply.

**Evidence:** Test against the real `AgentConsole` fails. Both browsers capture a new board-open request for C's session ID while the address is still `/sessions/A/chat`.

**Fix direction:** Pin the pending conversation's live identity too. A confirmed replacement should retire its board and require explicit navigation; a same-session transport reconnect should retain it. Preserve old drafts without automatically forwarding them to a replacement.

### N7 — A delayed tab-close response dismisses a different selected agent (high)

**Reproduce:** Start closing A's tab; while the request is pending, use Back then Cancel in the edit dialog, select B, and let A's close complete. The page unexpectedly returns to overview and unmounts B's composer.

**Cause:** `CloseTabButton.tsx:77–81` always runs its captured `onClosed()` on success. React Query's mutation-option callbacks still run after the initiating component unmounts. There is no check that A is still selected.

**Evidence:** Integration uses the real close mutation and a deferred API promise. Both browser engines reproduce the exact dialog interactions and navigation to `/` after B is selected.

**Fix direction:** Always update/invalidate data when a close finishes, but navigate only if the selected destination still belongs to the closed tab. Guard by selection identity, not just component-mounted state; other panes in the same closed tab also need correct handling.

### N8 — A dismissed agent-creation request later steals navigation (medium)

**Reproduce:** Submit New Agent, dismiss the still-pending dialog with Cancel, select A, and let creation finish. The app opens the newly created C instead of staying on A, potentially dropping A's draft.

**Cause:** `NewAgentDialog.tsx:40–49` retains its success callback after dismissal. `App.tsx:426–444` unconditionally calls `openAgent` when that callback arrives. Dismissing cannot undo creation already requested from the server, but it should revoke automatic navigation.

**Evidence:** Real mutation plus deferred API integration; both engines reproduce cancellation, selecting A, and the late jump to C.

**Fix direction:** Separate data completion from navigation intent. Add the created agent to the dashboard regardless, but navigate only while the initiating create flow still owns the current selection. Audit new-tab and history-resume callbacks under the same rule rather than assuming they are safe.

### N9 — Closing a directly linked board creates a Back/reopen cycle (medium)

**Reproduce:** Open `/sessions/A/whiteboard` directly. Use the board Back button to enter chat. Browser Back reopens the same board, rather than avoiding another chat/board cycle.

**Cause:** With no `fernblickChatIndex`, `selectSession` pushes a new chat entry. The helper's explicit intent is to avoid chat/board cycles, but it only handles boards opened from an existing chat entry.

**Evidence:** Helper assertion and both real browsers. Also reproduced at phone and portrait-tablet widths.

**Fix direction:** When closing a board with no validated same-session return entry, replace the board entry with chat. Preserve normal browser Back/Forward for a board genuinely opened from chat.

### N10 — Newly created shells use a chat URL and are not cached before opening (medium)

**Reproduce:** Create a New Shell Tab. Its destination is `/panes/P/chat`, even though the UI is a terminal. If dashboard refresh is held, the newly created shell is also unavailable until that refresh completes.

**Cause:** `App.tsx:460–464` calls `setSelectedPaneId(tab.pane_id)` without the terminal flag and without inserting the returned shell into the dashboard cache. Normal existing-shell selection does pass `true`.

**Evidence:** Integration holds dashboard refresh and confirms that the returned shell is not mounted (expected one, got zero). Both browsers independently confirm that new shells receive `/chat` URLs.

**Fix direction:** Cache the successful create response before selection and use `/terminal`, matching normal shell selection. Apply navigation-intent guards for delayed create completion as in N8.

## Additional helper-level risk, not a proven normal UI sequence

`fernblickChatIndex` is carried across session changes without recording which session it belongs to. A helper-level sequence A chat → A board → replace with B chat → B terminal → B board → close returns to **A's chat**. The current terminal UI has no Board button, so this exact sequence is not claimed as a reachable ordinary interaction. It was a failing helper invariant and is now covered by a passing normal regression test with the N2/N9 fix.

## Behaviors checked and found correct

New positive audit tests cover:

- Closing the currently selected tab returns to overview.
- **Exit agent session** differs from **Close tab**: exit keeps the saved conversation URL and offers resume once polling confirms inactivity. The inactive page itself is intentional; the stale waiting banner from the earlier report was not.
- A late session lookup for A does not select A after B is selected: query keys isolate the results.
- A late direct-link resume result does not overwrite the newly selected session's cache or URL.
- Ordinary chat/terminal/board changes keep the mounted draft.
- Overview remains reachable through repeated ordinary view cycles.

Existing tests were also rerun for saved-chat Back/Forward, fresh-session promotion/draft retention, failed polling, stale/deleted links, inactive links not auto-resuming, shell selection, saved-session pane-reuse guards in all three modes, same-session board recovery, and old target invalidation. In particular, **saved-session** pane-reuse guards work; N6 concerns the unpinned pending path.

## Reproduction and test artifacts

```sh
# Run from an isolated task worktree; the original fix worktree was removed.
npm ci
VITEST_MAX_WORKERS=2 npm run check

# Focused audit assertions:
npx vitest run src/app/App.navigation.test.tsx \
  src/app/navigation.audit.test.tsx \
  src/features/agents/AgentConsole.test.tsx -t 'audit:'

# Actual frontend + synthetic API/SSE, ephemeral loopback server:
node tools/design/session-navigation-audit.mjs
```

The audit assertions were first run as ordinary tests and failed on their intended URL/view/draft assertions (13 failing assertions covering ten cases plus duplicates and the helper invariant). Every expected failure has been converted to a normal passing regression test. Additional tests cover deferred shell creation, dismiss/reopen and unmounted dialogs, same-tab sibling closing, history-resume races, conversation-specific drafts, suspended attachments, fresh-baseline command gating, and runtime/epoch replacement.

The implementation branch passed **124 test files and 1,491 normal tests, with no expected failures**. After integration with latest `main` (which removed the standalone prototype tests), deployment verification passed **122 test files and 1,468 tests**, plus all 36 browser acceptance cases. Formatting, lint, both Knip modes, typechecking and production build passed. Tests were limited to two workers to avoid the repository's documented large-upload fixture contention; an initial unrestricted run timed out in the unrelated ten-image upload test.

The browser tool now asserts **fixed behavior** and prints `PASS`. It covers all ten cases at desktop width in Chromium and WebKit, plus fresh-session reload, early mode switching, direct-board history, and restart-window draft retention at 390 px and 820 px. All **36 browser acceptance cases pass**, including text and attachment preservation through an inactive poll. All APIs are intercepted, SSE is synthetic, external requests are blocked, and API/page errors are checked separately. No physical iPad/phone or real Pi-agent restart was used for these tests.

## Completed implementation groups

1. **Unify destination/identity ownership:** explicit pending pane routes, persistence-aware promotion, pinned mode changes, and same-session selection/Back behavior (N1/N3/N4/N6).
2. **Repair board history as one change:** session-scoped validated return entries, zero-delta fallback, direct-link replacement, and the cross-session helper invariant (N2/N9).
3. **Own drafts at conversation lifetime:** preserve through restart/inactive gaps without weakening replacement/exit handling (N5).
4. **Revoke stale navigation intent:** late close/create/resume/new-tab completion can update data but cannot hijack newer selections (N7/N8); fix shell caching/mode in that pass (N10).

The full transition matrix and real-browser fixtures have been rerun. Draft retention is limited to the selected conversation and is separate from live command authority. Reload-persistent composer drafts and survival across full browser/app unmounts are not added by this change; only the conversation URL survives reload. Physical-device and real Pi-agent restart smoke tests remain optional follow-up checks. Backend redeployment and read-only HTTPS/API health checks succeeded; the rollback build was retained.
