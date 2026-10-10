# Fernblick Pi live chat

Standalone Pi package for **ordinary interactive CLI Pi 1.1.0** on Linux.
No backend imports, SQLite, session-file reads, RPC subprocess, terminal scraping,
or additional TCP listener. All runtime files are in this directory.

## Install (user action)

From a checkout with `npm ci` already run at its root:

```sh
pi install /absolute/path/to/herdr-fernblick/packages/pi-live-chat
```

For a standalone copy of this directory, first install its own runtime dependency:

```sh
cd /absolute/path/to/pi-live-chat
npm install --omit=dev --ignore-scripts --legacy-peer-deps
pi install /absolute/path/to/pi-live-chat
```

Pi supplies the peer `@earendil-works/pi-coding-agent`; do not bundle another copy.
The checkout pins Pi 1.1.0 as a development dependency for API type-checking and
isolated real-Pi loader, skill, navigation, and compaction tests. The backend does
not import that development copy or use it to run user agents.
Local-path Pi installs reference the directory rather than copying it, and Pi does
not install local package dependencies. Keep the directory in place. An npm
publication of this package would install its declared runtime dependency normally.

The user-run `pi install` command writes personal Pi settings. Fernblick does not
edit global settings. Start a new interactive Pi or use `/reload` yourself.
Loading the extension grants Fernblick access to model chat, thinking, and
send/abort controls for the same Unix user.

Fernblick-created agents explicitly load this same extension. Set
`FERNBLICK_PI_GLOBAL=1` on the **backend** if it is already installed globally.
A process-wide owner also prevents duplicate connections when a global and
explicit copy are both loaded. Reload/shutdown relinquishes ownership.

## Configure both processes

By default the extension connects to
`~/.local/share/fernblick/live/pi.sock`. Set `FERNBLICK_PI_SOCKET` to the **same
absolute path** for Fernblick and Pi to use another backend. This is separate from
`HERDR_SOCKET_PATH`; it does not allocate a network port.

Pi must inherit `HERDR_PANE_ID` and `HERDR_SOCKET_PATH` from Herdr. For
Fernblick-created agents, environment comes from the Herdr session, not the
Fernblick HTTP process: configure the custom Pi socket in that Herdr environment
before starting agents. Changing only the backend environment will not reconfigure
existing Pi agents. For isolated development use a separate Herdr session and a
separate Pi socket path. Do not point test instances at user agents.

The socket path must be at most 100 bytes. The backend creates its parent directory
as 0700 and socket as 0600. Existing insecure directories, symlinks, other owners,
and non-socket paths are rejected, not chmodded or removed. A stale socket is removed
only after connection refusal and an unchanged inode/device check. An active
server is never replaced. Private-directory permissions define the same-user
trust boundary; this is not isolation from malicious programs running as you.

Images use the shared same-user directory `/tmp/fernblick`. Set
`FERNBLICK_UPLOAD_DIR` identically for backend and Pi to override it. The directory
must be absolute, owned by the user, 0700 and without symlink ancestors; use a path
shorter than 94 bytes (it shares the private-directory validator). Upload files
must be regular, private, single-link files owned by that user. Only validated
UUID upload IDs—not arbitrary paths—are accepted. Missing temporary files remain
unavailable; no automatic retry or send occurs.

## Custom footer mirror

When the optional cb-dotfiles `status-footer.ts` publisher is installed, chat uses
its full ANSI footer lines, before terminal-width truncation. The browser wraps
them on a navy surface to keep the terminal's pale colors readable. Long output
scrolls vertically within a bounded area. Only terminal colors and common text
attributes become styles; HTML, links and terminal actions are inert.

The versioned Pi event contract is `pi.status-footer.request.v1` (request with
`sessionId`, `sessionFile`) and `pi.status-footer.update.v1` (publication with
`version: 1`, the same session identity, and `lines: string[] | null`). Lines are
limited to two, each at most 8,192 characters. Null withdraws the publisher.
Startup, reconnect and context changes request fresh output. Updates are
session-bound; reload/shutdown clears state. Snapshots carry optional
`status.footerLines`; old publishers/consumers retain the previous fallback.
The fallback's displayed-token accounting still covers only projected history,
not the full session totals produced by the custom footer.

No footer is replaced by this extension, no terminal is scraped and no account
API is called by Fernblick. The installed footer owns formatting and Codex
refreshes. Both repository changes need later user-approved activation: install
the updated dotfiles footer and live-chat package, reload Pi, and rebuild/restart
Fernblick. Do not edit active global settings or restart the app as part of a
review handoff.

## Behavior and limits

- Long-lived bidirectional Unix connection starts only at `session_start`, only
  in TUI mode, and closes at `session_shutdown`. Missing backend is harmless.
  Reconnect uses jittered exponential backoff (250 ms to 15 seconds); no Pi handler
  awaits network or drain.
- History comes only from public `ctx.sessionManager.getBranch()`, not JSONL.
  Ordinary user/assistant/thinking/tool content shares one projector with live
  message and tool events. `message_end` is provisional: Pi persists afterward
  and later extensions may transform it. `turn_end` and `agent_settled` replace
  the overlay with persisted branch content.
- Each connection/branch epoch has ordered sequence numbers. Reconnect sends
  fresh history plus any still-live overlay. Full replacement snapshots are
  coalesced to at most one per 50 ms; no replay/event backlog is retained.
- Recent history: last 512 branch entries, at most 512 rendered rows/2 MiB;
  per-row text 32,000 characters; live overlay at most 64 messages/2 MiB;
  protocol frame and pending writes at most 4 MiB. Truncation is shown.
  Usage is for retained ordinary branch entries, not exact Pi session totals.
- Select/preview/upload up to ten PNG, JPEG, GIF or WebP images, at most 10 MiB
  each. Image-only sends are supported. Commands carry upload IDs, not base64.
  The extension performs bounded, no-follow reads, checks owner/mode/link count,
  size and file signatures, then converts to Pi ImageContent. After async reads it
  rechecks generation, session, epoch, connection and idle state before invocation.
  Draft text, files and uploaded IDs stay in the composer on ACK or uncertain error.
- History prefers original `/api/uploads/<id>` URLs using content-hash references
  stored as Pi custom metadata (never model messages or delivery state). Pi may
  resize/re-encode images; unmatched large normalized images are copied into the
  shared directory asynchronously and served through the same HTTP endpoint.
  Small unreferenced raster images can remain inline (128 KiB maximum). At most
  four image copies run concurrently; startup hydration covers the last 16 branch
  entries, with at most 4096 cached image references. Older unreferenced large
  images, missing files and invalid data may remain unavailable. Uploads are
  temporary and require manual lifecycle/storage management.
- Browser sends require idle Pi, no pending native messages/UI prompt, and no
  unresolved Fernblick invocation. `pi.sendUserMessage` returns **void**.
  ACK means **invoked**, never guaranteed accepted; input hooks or asynchronous
  runtime failures can prevent a turn. The browser clears text and images on a
  validated forwarding ACK, without any Pi receipt or text comparison. Failed or
  uncertain forwarding preserves the visible draft and unlocks editing. HTTP
  forwarding waits at most 15 seconds. There is no hidden recovery copy, reconnect
  retry, durable delivery, or native queue. Working/idle events gate subsequent
  sends independently. A 15-second handoff guard prevents rapid double submission
  during async Pi preflight, clears on `agent_start` or `agent_settled`, and expires
  without retry if no run begins. Expiry never overrides native busy/UI-prompt or
  pending-message checks.
- Manual compaction is a dedicated `compact` operation advertised by
  `capabilities.compact`, not a chat command or keystroke. It requires an idle
  current target and serializes until `ctx.compact` calls `onComplete` or
  `onError`. Only completion after persistence produces `compacted`; a forwarding
  ACK is insufficient. Branch/footer state is reconciled and drafts/images stay
  unchanged. Backend/browser deadlines are 120/125 seconds. Disconnect or timeout
  is uncertain and never retried; the runtime guard stays held across reconnect
  until a callback. If no callback arrives, inspect/reload Pi manually.
- Stop invokes void `ctx.abort()`. Working/stopped state comes from later Pi
  events, not the ACK or Herdr status. `agent_end` alone is not final settlement.
- Conversation paths are requested on open from public `getTree()/getLeafId()`,
  with labels and the actual active branch, not JSONL or polling. The original
  dialog/search/filters are restored. Navigation validates the selected entry and
  uses an instance-unique registered `/fernblick-bridge-<instance>` command plus
  a one-use in-memory nonce to obtain a real command context. Internal command
  tokens reaching normal input are consumed. No command is sent through Herdr
  and no LLM prompt is submitted. The handler awaits
  `ctx.navigateTree(entryId,{summarize:false})` before replying; Pi itself moves
  user selections to their parent/root. User text and available image IDs return
  to the composer. Tree success creates a fresh epoch/SSE snapshot.
- Commands are serialized, including image preparation and navigation. A nonce
  expires after four seconds; shutdown invalidates it. Cancellation, stale
  identity, busy Pi, a missing entry/handler, disconnect or timeout is not reported
  as successful navigation. An already-running navigation cannot be rolled back
  on disconnect/timeout: inspect Pi before retrying; no automatic retries occur.
  Trees over 2000 raw entries, 256 levels or 2 MiB are rejected explicitly. Prompts
  over 32,000 characters cannot be restored; use Pi for those cases.
- Public extension events are **not a complete TUI mirror**. Shell commands,
  custom entries/messages/renderers, compaction summaries and arbitrary terminal
  UI are out of scope. Nested tool execution can appear provisionally; only
  persisted ordinary results remain after reconciliation.
- Saved sessions are required for safe Herdr mapping; ephemeral `--no-session`,
  non-TUI modes, remote Pi processes, missing /proc access, background processes,
  unavailable extensions and ambiguous pane claims are rejected.

The backend checks a unique pane/socket/session claim against a same-user live
Linux PID and process-start time, inherited Herdr environment and foreground
process group. Browser commands carry runtime/session/epoch identity, revalidate
Herdr and the process, and are checked again inside Pi immediately before
invocation. This is fail-closed best-effort process association, not an OS atomic
transaction with Herdr: same-user process changes can race a foreground check.

See the repository's `docs/pi-live-chat.md` for API and verification details.
