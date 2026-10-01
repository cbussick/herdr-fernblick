# Live Pi chat implementation

## Boundaries

- `packages/pi-live-chat/` is an independently installable Pi package with a
  `pi.extensions` manifest. Runtime dependencies are only Zod and Node built-ins;
  Pi types are a host-provided peer. There are no backend imports or SQLite APIs.
- `server/pi/liveBridge.ts` owns the private socket, live registry, validated
  process association, and bounded one-command-in-flight request/ACK handling.
- `server/pi/liveEvents.ts` sends an initial snapshot, then sequenced patches of
  changed rows over HTTP SSE. Backpressured clients skip intermediate snapshots
  and receive the latest state on drain; no replay queue accumulates. Each
  subscriber resolves Herdr **once**, then routes matching registered snapshots
  directly. Ordinary streaming performs no Herdr requests. New socket connections
  are process-checked; commands revalidate both Herdr and process identity.
- `useLiveChat` subscribes by immutable pane ID, reconnecting when the dashboard's
  session identity changes. Returning to a visible tab, network restoration while
  visible, and persisted `pageshow` request a fresh subscription. Lifecycle bursts
  are coalesced and rapid successful recoveries are rate-limited. EventSource
  handles ordinary reconnects natively; terminal CLOSED streams and malformed
  frames retry with jittered exponential backoff (1 second initially, capped at
  30 seconds). Superseded connection callbacks cannot update state. EventSource
  reconnect receives a full fresh snapshot, not a delta replay; stale sequence
  numbers in the same epoch are ignored.
- Dashboard polling is unchanged. Agent output polling and Herdr key controls
  exist only in Terminal view. Chat send/stop never use Herdr terminal input.

## HTTP / wire contract

`GET /api/agents/:paneId/chat` opens SSE: an initial versioned `snapshot` with
runtime/PID/process-start/pane/Herdr-socket/session identity, epoch and sequence,
then `patch` frames carrying metadata, `baseSeq`, changed rows (`upsert`), and an
optional complete ID `order` when rows are added, removed or reordered. Patches
require the exact baseline; invalid baselines reconnect for a full snapshot.
Runtime/epoch/session changes always send a full snapshot. Network interruptions
and lifecycle recovery keep the existing transcript and draft visible but disable
commands (including already-open tree navigation) until a valid fresh snapshot.
An unchanged snapshot sequence is valid on a new connection. Both initial startup
and recovery have a fixed 30-second error-notice deadline; lifecycle events do not
extend it, and late snapshots still recover. No commands are replayed. Changing
runtime/session/epoch invalidates an open tree dialog.
`{type:"connecting",reason}` represents initial session/extension registration.
The UI shows a starting/connecting spinner rather than a red error, with a fixed
30-second startup deadline (progress notices do not restart it). A late valid
snapshot still recovers normally. Identity, ambiguity and unsupported-agent
failures remain immediate `unavailable` errors; a previously connected stream
losing its peer is not classified as a new-agent startup.
`{type:"unavailable",reason}` explicitly invalidates the displayed session.
There is no file/terminal fallback. Snapshot version 2 identifies the current
image-capable send bridge. Version 1 remains readable, but the browser disables
sends and asks for `/reload` rather than silently using an older bridge.
SSE IDs are `epoch:seq`; `Last-Event-ID` is intentionally not replayed.
Keepalive comments carry no chat data and do not trigger Herdr reads.

`POST /api/agents/:paneId/prompt` accepts
`{target:{runtime,epoch,sessionId},text,attachments:[uploadId,...],requestId?}` (text may be
empty with images); `POST .../stop` accepts the same target. Existing upload
endpoints accept up to 10 MiB per PNG/JPEG/GIF/WebP image. The socket carries at
most four validated IDs; bounded local file reads and ImageContent conversion
happen only inside the standalone extension.
Mutations require matching Origin and JSON. Bodies are limited to 40,000 bytes,
text to 32,000 characters. The extension validates the command again against its
current context with no await before invoking Pi. Commands are not persisted or
retried; duplicate IDs are rejected (up to 1024 seen IDs per runtime lifecycle,
then reload required). ACK is `outcome:"invoked"` or `"rejected"`, not delivery
confirmation. The browser validates the correlated forwarding ACK, clears the
submitted text and images, and unlocks editing immediately. It does not wait for
a Pi user-message event or compare text. The HTTP command has a 15-second browser
deadline. Rejection, malformed ACK, timeout or network loss preserves the visible
draft and unlocks the composer with an error; uncertain sends are never retried
automatically. There is no hidden recovery copy. Pi busy/idle state independently
gates the next send.

`POST .../tree` accepts `{target}` and returns a correlated typed tree from
public Pi `getTree()/getLeafId()`. `POST .../tree-navigation` accepts
`{target,entryId}` and returns `navigated` only after command-context navigation
completes, with the new target epoch and optional restored `{text,attachments}`.
Opening the original dialog makes one request, without focus/reconnect polling;
mutations are never automatically retried.

The private transport is bounded newline-delimited JSON, **not a Pi session JSONL
reader**. Extension event handlers update an in-memory projector and schedule a
coalesced publish; they never await networking. Slow socket peers are dropped
rather than accumulating writes. SSE pauses on backpressure and resumes with the
latest state; a reader stalled for over 60 seconds is disconnected. There are at most 64 socket peers and 64 SSE subscribers,
a 3-second initial handshake deadline and a 5-second command deadline.
No extra TCP listener, chat polling, queue store or dispatcher exists.

## Verified Pi 0.99.1 contracts

Inspected installed documentation (`extensions.md`, `packages.md`, configuration,
settings, CLI, sessions, session-format, message-types and SDK) and actual
`dist/core/extensions/types.d.ts`, `runner.js`, `agent-session.js` and loader.

- `ExtensionAPI.sendUserMessage` returns void; the runner invokes the asynchronous
  implementation and reports rejected promises separately. We cannot claim ACK
  equals accepted input, even when no synchronous exception is thrown.
- `ExtensionContext.abort` returns void.
- `message_end` extension handlers run before the session manager appends the
  message. Later handlers may replace it. Live content is provisional until
  `turn_end` and `agent_settled` reconciliation.
- `agent_end` may precede retry/compaction/continuation. `agent_start` clears the
  preflight handoff guard and marks the runtime active; `agent_settled` clears it
  and marks the runtime idle. The guard expires after 15 seconds if Pi never emits
  a run event, without retrying. Native busy and pending-message checks still apply.
  This gate is not a receipt or durable-persistence guarantee.
- Old contexts assert inactive after replacement. Shutdown invalidates retained
  context, destroys sockets and cancels timers; generation checks prevent late
  asynchronous connection attempts from reviving it.
- `getBranch` is the authoritative active branch. Abandoned branches are not
  reconstructed from file order.
- Navigation is command-context-only. The extension registers an instance-unique
  private command, verifies registration, stores one bounded one-use nonce and
  invokes `pi.sendUserMessage("/fernblick-bridge-<instance> <nonce>",
{expandPromptTemplates:true})`. Actual Pi command dispatch runs before model
  input and supplies a real command context. An input guard consumes any stale
  internal prefix that falls through command dispatch. The command handler catches
  failures and reports rejection itself, revalidates before navigation, awaits
  `ctx.navigateTree(entry.id,{summarize:false})`, then replies on the captured
  socket. Pi 0.99.1 moves user targets to their parent, including the null root.
  Reload/session replacement are not exposed. This ephemeral nonce is not a
  delivery queue; timeout/shutdown cancels it and no model work is requested.

## Safety and limits

See the [standalone package README](../packages/pi-live-chat/README.md) for install,
socket permissions, mapping checks and all transcript/buffer limits.

Linux /proc and a saved session matching Herdr are required. Same-user filesystem
permissions, not a secret token, protect the socket. Unique live foreground
mapping is required; mismatches/ambiguity disable chat rather than guessing.
There is a normal cross-process race between a validated foreground observation
and command delivery; runtime/session/epoch checks prevent delivery into a
replacement Pi context, but this is not atomic with Herdr.

This projects ordinary model chat, not every shell/custom entry or TUI renderer.
Nested tool output is transient unless persisted by Pi. Image selection, previews,
uploads, image-only sends and tree navigation are restored. Shared upload reads
check owner, private mode, regular/single-link file, no symlink, bounded size and
magic bytes; they never read an arbitrary browser-supplied path. Async preparation
revalidates identity/epoch/busy state immediately before invoking Pi. History image
references are non-context custom metadata, not delivery records. Original images
are served by upload ID; resized/re-encoded images can require a temporary copy.
See package limits for old/unreferenced images and oversized trees.
Usage totals cover retained ordinary entries.
Sends consumed by another extension without starting a turn remain unresolved;
inspect Pi and reload the extension before sending again. Drafts are memory-only
in the open console, not persistent across page reload/navigation.

The previous SQLite database and upload files are preserved without opening or
migrating them. Legacy queue routes still return 404. Upload endpoints now support
live sends; tree routes are POST requests guarded by current runtime/session/epoch.
Navigation is serialized, with a four-second nonce deadline; an operation already
inside Pi may complete after timeout/disconnect. Such outcomes remain uncertain,
never success ACKs, and should be checked in Pi before manual retry.

## Verification

`npm run check` includes strict compilation against pinned Pi 0.99.1 types,
compilation of server/package tests, unit/integration tests and production build.
Tests use fake Pi contexts/events and isolated Unix socket/HTTP fixtures, never
existing user agents. Coverage includes lifecycle/duplicate loading/reconnect,
provisional-to-persisted reconciliation, tools/thinking/images/errors/limits,
stale identities and busy/concurrent sends, uncertain disconnects, socket
permissions and stale-path handling, ordered snapshots and fresh SSE reconnect.
Browser-hook regression tests simulate silently stalled and terminally closed
streams, visibility/online/persisted-pageshow recovery, reconnect bursts/backoff,
stale callbacks, fixed deadlines, full-to-patch baselines, cleanup and Strict Mode.
Console tests cover retained drafts/images without command replay and already-open
tree gating/identity invalidation. These simulate lifecycle events; actual OS
screen-lock/sleep behavior in a real browser remains a manual verification step.
A streaming-race regression advances a snapshot during an awaited process check;
an SSE test verifies one Herdr lookup despite repeated live frames.

The loader test invokes actual Pi `install <path>` into a disposable
`PI_CODING_AGENT_DIR` under this worktree and then actual Pi jiti loading of
`index.ts`, including relative `.js` imports resolving to package TypeScript.
No personal configuration is touched. Restoration tests first failed for four
10 MiB image-only sends, original image history URLs, socket tree reads and
command-context navigation, then passed after implementation. Filesystem-boundary
tests pause image preparation and change epoch/session/busy state before resuming.
HTTP tests cover all four formats, the original 10 MiB limit, four-ID/image-only
requests and unsafe files. Restored image-only prompts retain their attachment IDs.

A real Pi 0.99.1 `createAgentSession`/SessionManager harness exercises
`sendUserMessage` → registered command dispatch → `navigateTree(user.id)`.
It verifies labels and active branch via real `getLeafId()`, user-to-root
navigation, and that both the agent prompt and model stream remain uncalled,
including an internal token that reaches the normal input guard.
Tests do not call a provider; existing user agents and browser layout have not
been manually exercised.

Dependency audit currently reports two development-tool findings: the pre-existing moderate `fast-uri` advisory and a high `brace-expansion` advisory pinned by Pi 0.99.1's published shrinkwrap. The Pi dependency is for type/loader verification, not imported by the backend at runtime. The standalone extension's runtime dependency is Zod. `npm run check` does not include `npm audit`; these findings remain unresolved.

The original conversation-tree and attachment-preview styles were restored
narrowly from commit `435eec2`, along with the tree button/composer column. No
dashboard, Terminal or shared-layout redesign was performed.
