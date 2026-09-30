# Live Pi chat implementation

## Boundaries

- `packages/pi-live-chat/` is an independently installable Pi package with a
  `pi.extensions` manifest. Runtime dependencies are only Zod and Node built-ins;
  Pi types are a host-provided peer. There are no backend imports or SQLite APIs.
- `server/pi/liveBridge.ts` owns the private socket, live registry, validated
  process association, and bounded one-command-in-flight request/ACK handling.
- `server/pi/liveEvents.ts` sends full sequenced snapshots over HTTP SSE. Each
  subscriber resolves Herdr **once**, then routes matching registered snapshots
  directly. Ordinary streaming performs no Herdr requests. New socket connections
  are process-checked; commands revalidate both Herdr and process identity.
- `useLiveChat` subscribes by immutable pane ID, reconnecting when the dashboard's
  session identity changes. EventSource reconnect receives a full fresh snapshot,
  not a delta replay; stale sequence numbers in the same epoch are ignored.
- Dashboard polling is unchanged. Agent output polling and Herdr key controls
  exist only in Terminal view. Chat send/stop never use Herdr terminal input.

## HTTP / wire contract

`GET /api/agents/:paneId/chat` opens SSE: either a versioned `snapshot` with
runtime/PID/process-start/pane/Herdr-socket/session identity, epoch and sequence,
or `{type:"unavailable",reason}`. Availability is explicit; no file/terminal fallback.
SSE IDs are `epoch:seq`; `Last-Event-ID` is intentionally not replayed.
Keepalive comments carry no chat data and do not trigger Herdr reads.

`POST /api/agents/:paneId/prompt` accepts
`{target:{runtime,epoch,sessionId},text}`; `POST .../stop` accepts the same target.
Mutations require matching Origin and JSON. Bodies are limited to 40,000 bytes,
text to 32,000 characters. The extension validates the command again against its
current context with no await before invoking Pi. Commands are not persisted or
retried; duplicate IDs are rejected (up to 1024 seen IDs per runtime lifecycle,
then reload required). ACK is `outcome:"invoked"` or `"rejected"`, not delivery
confirmation. Transport timeout/loss is uncertain.

The private transport is bounded newline-delimited JSON, **not a Pi session JSONL
reader**. Extension event handlers update an in-memory projector and schedule a
coalesced publish; they never await networking. Slow peers are dropped rather than
accumulating writes. There are at most 64 socket peers and 64 SSE subscribers,
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
- `agent_end` may precede retry/compaction/continuation; only settled clears the
  invocation latch.
- Old contexts assert inactive after replacement. Shutdown invalidates retained
  context, destroys sockets and cancels timers; generation checks prevent late
  asynchronous connection attempts from reviving it.
- `getBranch` is the authoritative active branch. Abandoned branches are not
  reconstructed from file order.
- Navigation/reload/session replacement are command-context-only. Chat exposes
  none of them.

## Safety / deliberately deferred

See the [standalone package README](../packages/pi-live-chat/README.md) for install,
socket permissions, mapping checks and all transcript/buffer limits.

Linux /proc and a saved session matching Herdr are required. Same-user filesystem
permissions, not a secret token, protect the socket. Unique live foreground
mapping is required; mismatches/ambiguity disable chat rather than guessing.
There is a normal cross-process race between a validated foreground observation
and command delivery; runtime/session/epoch checks prevent delivery into a
replacement Pi context, but this is not atomic with Herdr.

This projects ordinary model chat, not every shell/custom entry or TUI renderer.
Nested tool output is transient unless persisted by Pi. Small validated raster
ImageContent remains viewable; outgoing images and tree navigation are explicitly
disabled/deferred in UI. Usage totals cover retained ordinary entries.
Sends consumed by another extension without starting a turn remain unresolved;
inspect Pi and reload the extension before sending again. Drafts are memory-only
in the open console, not persistent across page reload/navigation.

The previous SQLite database and upload files are preserved without opening or
migrating them. Legacy queue and tree routes return 404. Retained upload endpoints
are not used for live sends.

## Verification

`npm run check` includes strict compilation against pinned Pi 0.99.1 types,
compilation of server/package tests, unit/integration tests and production build.
Tests use fake Pi contexts/events and isolated Unix socket/HTTP fixtures, never
existing user agents. Coverage includes lifecycle/duplicate loading/reconnect,
provisional-to-persisted reconciliation, tools/thinking/images/errors/limits,
stale identities and busy/concurrent sends, uncertain disconnects, socket
permissions and stale-path handling, ordered snapshots and fresh SSE reconnect.
A streaming-race regression advances a snapshot during an awaited process check;
an SSE test verifies one Herdr lookup despite repeated live frames.

The loader test invokes actual Pi `install <path>` into a disposable
`PI_CODING_AGENT_DIR` under this worktree and then actual Pi jiti loading of
`index.ts`, including relative `.js` imports resolving to package TypeScript.
No personal configuration is touched. Tests do not call a provider; real interactive agents and browser layout have not been manually exercised.

Dependency audit currently reports two development-tool findings: the pre-existing moderate `fast-uri` advisory and a high `brace-expansion` advisory pinned by Pi 0.99.1's published shrinkwrap. The Pi dependency is for type/loader verification, not imported by the backend at runtime. The standalone extension's runtime dependency is Zod. `npm run check` does not include `npm audit`; these findings remain unresolved.

CSS removals are scoped to removed queue/tree UI and disabled attachment previews.
Shared console, transcript, image lightbox, shell composer overrides, and
dashboard styles remain; the chat composer loses the removed tree-button column.
