# Live Pi chat implementation

## Boundaries

- `packages/pi-live-chat/` is an independently installable Pi package with a
  `pi.extensions` manifest. Runtime dependencies are Zod and Node built-ins plus
  the host-provided Pi AI thinking-capability helper. Pi types and Pi AI are peers.
  There are no backend imports or SQLite APIs.
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
`{type:"connecting",reason}` represents session/extension registration or a
recoverable bridge disconnect. Initial startup shows a connecting spinner with a
fixed 30-second deadline (progress notices do not restart it). After connection,
a missing peer retains the transcript, shows reconnecting feedback and disables
commands until a fresh snapshot arrives. Recovery has its own fixed 30-second
notice deadline; a late valid snapshot still recovers normally. Identity,
ambiguity and unsupported-agent failures remain immediate `unavailable` errors.
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
most ten validated IDs; bounded local file reads and ImageContent conversion
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

The transcript's activity row shows visible, screen-reader-announced progress
during a send, in the same place as `Working` (never beneath the composer):
`Uploading image N of M…` for sequential browser uploads, then `Sending message…`
while awaiting the forwarding ACK (including extension-side image preparation).
After forwarding, a live `sendPending` guard shows `Waiting for agent activity…`
until Pi starts or the guard clears. This is not proof of receipt or a delivery
queue. Errors replace local progress, preserve the draft/images, and require an
explicit retry. Reconnect hides the handoff notice; no activity is inferred from
elapsed time and no artificial percentage is shown. Uploading, sending and
handoff update this one row without shifting the composer; a live busy event takes
precedence and changes it to `Working` or `Compacting…`. Stop appears only while
Pi is busy, never during upload/forwarding/handoff. The row disappears when idle.

`POST .../tree-page` accepts `{target,page}` for peers advertising
`capabilities.treePages: true`. The dialog requests a flat, bounded page from
public Pi `getEntries()/getLeafId()`: at most 50 rows, 240-character text previews,
and 128 KiB of page data. Initial browsing ends at the current visible leaf;
explicit branch exploration can follow an abandoned continuation. Search and
Your prompts/Labels filters cover the entire session, not only the loaded path.
No recursive tree or full message bodies are sent to the browser. See
[conversation path paging](conversation-paths.md) for cursors, branches and limits.

`POST .../tree-navigation` still accepts `{target,entryId}` and returns `navigated`
only after command-context navigation completes, with the new target epoch and
optional restored **full** `{text,attachments}`. Previews are never submitted as
prompts. Reads are serialized/debounced in the browser, with no focus/reconnect
polling or automatic retries; navigation is also never retried. Older live
extensions receive a specific `/reload` explanation before an unknown command is
sent. The original `/tree` endpoint and wire response remain for legacy clients;
they retain their old size/depth limits but are no longer used by this dialog.

`POST .../compact` accepts `{target}` for peers advertising
`capabilities.compact: true`. The composer toolbar has a three-dot **More conversation
actions** button immediately after **/Skills**, before Send. Its overflow menu
contains **Tree**, **Model**, **Thinking level**, and **Compact conversation**.
Tree, Model and Thinking level each retain an icon to the left of their label.
Tree opens the existing conversation-path dialog; Model and Thinking level open
session-settings pickers. Neither Tree nor Model has a standalone toolbar button.
Unavailable actions include an explanation or disabled reason. A native HTML popover places the menu above the composer in the top layer,
without clipping; position follows resize/scroll and the visual viewport. This
requires a modern Popover API browser (including Safari/iPadOS 17+).
Arrow keys/Home/End navigate, Enter/Space select, Escape restores trigger focus,
and Tab/outside clicks dismiss without selecting. Runtime/session/epoch changes
and disconnect invalidate an open menu. Additional actions can use the local
`ConversationAction` list, independently of the Skills catalogue.
Selection opens the existing explanation/confirmation; opening the menu alone
never invokes Pi. Confirmation and feedback appear below the toolbar inside the
same surface only when needed; there is no persistent idle row. Cancel and Escape
restore focus to the three-dot trigger.
It never uses the skills menu, ordinary `/compact` text, or terminal keys. It summarizes older model context
without clearing the visible history or starting a new session. Draft text and
images remain editable and unchanged. Keyboard-shortened viewports can scroll
the composer to keep confirmation and feedback reachable.

Both backend and extension revalidate idle/runtime/session/epoch state and
serialize the operation. The extension calls void `ctx.compact({onComplete,onError})`;
only the completion callback produces a correlated `{type:"compacted",id,target}`
response, after branch/footer reconciliation. Errors are rejected explicitly.
This operation has a 120-second backend result deadline and a 125-second browser
deadline (other commands retain their existing deadlines). A temporary browser
live-stream interruption shows reconnecting feedback, not a permanent request
invalidation. A fresh same-target snapshot restores waiting, and a correlated
completion response can still confirm success. Confirmed target replacement,
malformed result, request disconnect or timeout remains uncertain, never a
success inferred from an ACK or an idle event. While a fresh same-target snapshot
reports `compacting`, an uncertain request shows informational progress instead
of a red warning; the uncertainty returns when activity ends without a completion
response. Feedback survives missing snapshots and same-target recovery, but is
cleared after a settled request's target is replaced. No operation is automatically
retried. The extension
keeps its in-flight guard across socket reconnection until a terminal callback;
a missing callback therefore requires inspecting/reloading Pi, not an automatic
unlock or second compaction. Progress/results are transient, not persisted or
replayed after reconnection.

Live snapshots also carry an optional `compacting` flag, independent of the
browser's manual request. `session_before_compact` sets it; `session_compact`
or `session_compact_failed` clears it, including cancellation. Chat labels its
busy indicator **Compacting…** instead of **Working** during terminal `/compact`
and automatic compaction too. The flag survives socket reconnection, resets on
session replacement/shutdown, and is absent on older bridges (generic Working).
This is transient activity, not a success confirmation for a browser request.
No terminal scraping or polling is used.

Verified pinned Pi 0.99.1 and installed Pi 1.0.4 source contracts: `ctx.compact`
returns void; manual compaction aborts active work internally, hence the idle
precondition matters; `isIdle()` excludes compaction; `session_compact` is emitted
after persistence but before final idle-state cleanup; `onComplete` runs after
that cleanup. Cancellation, already-compacted/small sessions and provider errors
reach `onError`. A real isolated Pi 1.1.0 fixture uses a custom compaction hook
to verify persistence, busy/idle state, callback completion and already-compacted
failure, without provider calls.

`POST .../models` accepts `{target}` and returns a correlated catalogue from the
selected agent's public `ctx.modelRegistry.getAvailable()`. Only model ID,
provider and display name cross the socket (at most 1,000 models, with an explicit
truncation notice); no keys, headers or endpoints are exposed.
`POST .../set-model` accepts `{target,provider,modelId}`. Both endpoints require
`capabilities.models: true`, matching Origin, JSON, current process mapping and
runtime/session/epoch. Older extensions show a `/reload` notice. Selection also
requires idle state, a currently available model, and the shared in-flight guard.
The extension calls public `pi.setModel(model)` with no preceding await after
validation. It returns a correlated `model-changed` response only after the
promise succeeds and current session/model state is checked; an ACK is not success.
The operation retains serialization until settlement, even over disconnect.
Uncertain/disconnected operations are never retried automatically.

The **Model** row in the three-dot menu opens a searchable modal with current-model indication, provider/ID metadata,
native focus trapping, Arrow navigation and Escape/close focus restoration to the
three-dot trigger.
Search Enter cannot submit the surrounding composer. Discovery happens only on
opening (or explicit error retry), never on keystrokes, focus or reconnect.
Pi activity disables switching; disconnect or identity replacement closes the
picker and discards stale results. Draft text/images and history are unchanged.
Pi persists the choice in this session without changing defaults for new agents
and applies its native thinking-level compatibility rules. Provider setup/login
remains in Pi. Native model selection may finish after a transport deadline;
inspect Pi before an explicit retry.

Tests cover extension discovery/filtering, idle/auth/identity gates,
serialization, duplicates, errors and shutdown; socket/HTTP capability, Origin,
input and correlated-result guards; browser current-model/search/loading/error
states, explicit selection, draft/image retention and stale-target invalidation.
An isolated real-Pi 1.1.0 fixture verifies the public API, session model-change
entry and unchanged global defaults without a provider request.
Synthetic Chromium/WebKit regressions cover 320/390px phones, a keyboard-height
viewport, iPad and desktop with all API/SSE traffic intercepted:

```sh
PLAYWRIGHT_MODULE=/tmp/fernblick-design-tools/node_modules/playwright/index.mjs \
  node tools/design/model-picker.mjs http://127.0.0.1:<static-port>
```

Screenshots are written to ignored `design-gallery/model-picker/`.
Existing agents are never controlled by these checks; physical-device keyboard
behavior and live provider calls remain manual verification.

`POST .../thinking-levels` accepts `{target}`, returning the current
`{provider,modelId,level,levels}` from public `pi.getThinkingLevel()` and
the host Pi AI `getSupportedThinkingLevels(ctx.model)` helper. No model-name
heuristics or trial mutations determine the choices: custom `thinkingLevelMap`
settings, extra-high/max support, and non-reasoning models are handled by Pi.
Non-reasoning models expose only Off with an explanation.

`POST .../set-thinking-level` accepts `{target,provider,modelId,level}`.
Both endpoints require `capabilities.thinking` and the existing Origin, process,
identity and serialization guards; setting also requires idle state, an unchanged
model and a currently supported level. The extension calls synchronous public
`pi.setThinkingLevel(level)` and verifies the resulting level and model before
returning `thinking-level-changed`. A forwarding ACK is not confirmation.
The browser validates the exact target/model/level; failures preserve the draft
and are never automatically retried. Global defaults are unchanged.
Snapshots carry optional `status.thinkingLevel`, refreshed by Pi's native
thinking/model events, so terminal changes are reflected too.

The **Thinking level** menu row opens a focused modal using the same styles as
Model. Discovery runs only on opening or explicit error retry. Changing the
session, disconnecting, or replacing the model closes it; requests also bind to
the model shown when the choices were fetched. Busy state disables selection
without discarding drafts/images. Legacy bridges show a reload notice.
Tests cover unsupported/custom levels, model replacement, busy/stale/duplicate
requests, failed or mismatched results, native Pi session persistence without
global-default changes, and HTTP/client validation. The model-picker browser
script also checks both labeled menu rows, thinking-level selection, keyboard
navigation, focus restoration, non-reasoning state and touch-sized layouts.

Each settings row also offers a star to **Set as global default**. This is a
separate, explicit save: ordinary model/thinking selection remains session-only.
A star saves that row directly without switching the current session or closing
the dialog. The saved choice shows a filled star and **Default** on the right,
independently of **Current**. No footer button or explanatory copy is needed.
Buttons are siblings, not nested; star labels identify the choice and global
scope. Keyboard focus remains on the star after saving, with a screen-reader
announcement; visible feedback is the updated row marker. Drafts, images,
conversation history and running sessions are untouched.

Model/thinking catalogues include `defaults:{model,thinkingLevel}` from fresh
global settings. The model is `{provider,modelId}` or null; the thinking level
is an explicit saved level or null. Null means no explicit global default, not
the active choice or a project/per-model override. Only these allowlisted fields
cross the socket. A read failure includes `defaultsError`, allows normal session
selection, disables default saves and offers an explicit retry. Metadata is
optional for compatibility: older bridges lack it, so row saves are disabled
with a reload notice. Reopening always re-reads settings, including defaults
saved by another process; markers also update only after a confirmed save.

`POST .../save-default` accepts `{target,selection}`, where selection is
`{kind:"model",provider,modelId}` or
`{kind:"thinking",provider,modelId,level}`. It requires `capabilities.defaults`,
same-Origin JSON, verified process mapping, matching runtime/session/epoch,
idle state and the shared serialization guard. The extension accepts any
currently available model without requiring it to be selected first. Thinking
saves accept any supported level but bind to the expected current provider/model.
Unavailable models, a changed thinking model or unsupported levels are rejected.

Persistence runs in the selected Pi process through its public `SettingsManager`,
using its global agent directory (normally `~/.pi/agent`, respecting
`PI_CODING_AGENT_DIR`), not the backend's environment. Model saves update
`defaultProvider` and `defaultModel` together; thinking saves update only
`defaultThinkingLevel`. A fresh manager ignores project settings and uses Pi's
locked, modified-field merge to preserve unrelated settings/concurrent changes.
Read/write errors are checked before saving and after `flush()`; only then is a
correlated `default-saved` response returned. An ACK, mismatched selection, or
lost connection is not confirmation; saves are never automatically retried.

Defaults apply to newly launched Pi sessions using that agent directory, not
only Fernblick-created agents. Project settings, per-model thinking overrides,
resumed-session choices and explicit launch options still take precedence.
Existing processes retain their current session state; no live setters or
prompts are invoked. Tests cover real isolated settings persistence, preservation
of project/unrelated settings, queued write errors, busy/stale/duplicate guards,
exact HTTP/client confirmation and both dialogs' feedback/serialization. Browser
checks cover direct row saves, persisted indicators on reopen, keyboard star
activation/focus, independent Current/Default state and removal of the footer.

`POST .../skills` accepts `{target}` and returns a correlated catalogue from the
active extension's public `pi.getCommands()`. Snapshots advertise
`capabilities.skills: true`; older bridges keep ordinary chat working and show a
reload notice rather than accepting unsupported skill sends. Skills are fetched
on opening the picker from the **/Skills** button (also while Pi is busy), not on
keystrokes or snapshots. Typing `/` does not activate the picker.
Each catalogue is bounded to 1,000 entries and 512 KiB of entry JSON, with an
explicit truncation notice. Metadata contains name, description, source path and
personal/project/temporary scope, never skill bodies.

A draft beginning with `/skill:` is validated against the freshly resolved Pi
catalogue after image preparation, immediately before forwarding. Only known,
unshadowed skills enable `expandPromptTemplates: true`; ordinary messages,
including other slash commands, remain literal. Argument whitespace is normalized
to Pi's literal-space separator. Selection only edits the visible draft, preserves
instructions/images and never sends or queues anything. Busy/identity/ACK behavior
is unchanged. Missing skills reject and retain the draft. Pi can still consume
input in a hook or fail a file read after forwarding; ACK is not proof of skill
expansion or completion. No backend filesystem scan, global configuration change,
terminal injection, or extra provider integration is involved. See
[Pi skill research](research/pi-skills.md) for source evidence and version caveats.

The private transport is bounded newline-delimited JSON, **not a Pi session JSONL
reader**. Extension event handlers update an in-memory projector and schedule a
coalesced publish; they never await networking. While the Unix socket is
backpressured, the publisher retains only a dirty bit and sends the latest full
snapshot after drain, skipping intermediate updates. A socket stalled for
60 seconds is dropped; command replies are never coalesced or replayed. SSE
pauses on backpressure and resumes with the latest state; a reader stalled for
over 60 seconds is disconnected. There are at most 64 socket peers and 64 SSE subscribers,
a 3-second initial handshake deadline and a 5-second command deadline.
No extra TCP listener, chat polling, queue store or dispatcher exists.

## Verified Pi contracts

The source inspection below originally targeted Pi 0.99.1. The development
dependency now pins Pi 1.1.0; the real-Pi loader, skill discovery/expansion,
command navigation, and compaction fixtures pass against that version.

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
  socket. Pi moves user targets to their parent, including the null root.
  Completion accepts a tail of non-message `custom` entries appended by
  `session_tree` hooks only if its ancestry reaches that exact destination.
  Plannotator persists its phase this way; comparing the final leaf ID literally
  used to reject a successful rewind and discard the restored prompt. Messages,
  custom messages, summaries, model/thinking changes, missing/cyclic ancestry
  and other branches still fail validation. Identity/connection checks remain.
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
Fallback usage totals cover retained ordinary entries; the optional custom footer mirror uses the publisher’s full-session accounting.
Sends consumed by another extension without starting a turn remain unresolved;
inspect Pi and reload the extension before sending again. Drafts are memory-only
in the open console, not persistent across page reload/navigation.

The previous SQLite database and upload files are preserved without opening or
migrating them. Legacy queue routes still return 404. Upload endpoints now support
live sends; tree routes are POST requests guarded by current runtime/session/epoch.
Navigation is serialized, with a four-second nonce deadline; an operation already
inside Pi may complete after timeout/disconnect. Such outcomes remain uncertain,
never success ACKs, and should be checked in Pi before manual retry.

## Footer mirror

The optional publisher in cb-dotfiles `pi/extensions/status-footer.ts` computes
its existing ANSI content once per render and publishes it before terminal-width
truncation. Live chat validates and forwards it as optional `status.footerLines`.
The publisher remains the only formatter/accounting implementation. Its branch,
extension statuses, context usage and 60-second Codex refreshes flow through the
same output. Request/replay handles either extension startup order; session/file
identity, shutdown clearing and canceled refresh generations prevent old-session
output from surviving replacement. No footer state is persisted.

Both socket snapshots and SSE full/patch frames validate at most two lines of
8,192 characters each. The browser renders escaped React text with a small
whitelisted SGR interpreter, not HTML or a terminal emulator. OSC links,
clipboard operations, cursor actions and unsupported control sequences are
discarded. Full lines wrap independently of terminal width and scroll vertically
when needed. A disconnected console hides its old status while reconnecting.
Without the publisher, legacy metadata remains available.

Activation requires later approval for integrating **both** repositories,
reloading affected Pi sessions, and rebuilding/restarting Fernblick. The task
worktrees do not change the installed footer symlink or active Pi settings.

## Verification

Send-feedback regression tests pause uploads and forwarding to verify text-only,
single-image and multi-image progress, handoff-to-working transitions, error
cleanup, draft preservation and explicit retry with cached uploads. Synthetic
Chromium/WebKit checks cover phones (including keyboard-height), iPad and desktop,
a single transcript activity row outside the busy surface, unchanged composer
geometry across progress transitions, viewport bounds and no command replay.
Every API/SSE call is intercepted; no live agents are controlled:

```sh
PLAYWRIGHT_MODULE=/tmp/fernblick-design-tools/node_modules/playwright/index.mjs \
  node tools/design/send-feedback.mjs http://127.0.0.1:<static-port>
```

Screenshots go to ignored `design-gallery/send-feedback/`. Physical-device keyboard
and screen-reader announcements remain manual verification.

Footer regression tests cover optional/bounded snapshot and patch payloads,
real socket replay/update/withdrawal, reconnect, stale-session rejection,
replacement, ANSI mapping and safe React rendering. Console tests cover status
invalidation on disconnect/replacement. The publisher has Node tests in the
dotfiles repository, loaded through real Pi jiti with a stub Codex executable;
they never access account credentials or the running terminal.

Run the synthetic Chromium/WebKit footer check against a static worktree build:

```sh
PLAYWRIGHT_MODULE=/tmp/fernblick-design-tools/node_modules/playwright/index.mjs \
  node tools/design/pi-footer.mjs http://127.0.0.1:<static-port>
```

Every API/SSE call is intercepted. It covers 320/390px phones, a short keyboard-like
viewport, iPad and desktop, RGB styling, inert HTML, fallback patches, oversized
segments, vertical scrolling, composer visibility and horizontal overflow.
Screenshots go to ignored `design-gallery/pi-footer/`.

HER-13 adds unit/socket/HTTP coverage for callback success/errors, native busy
and stale targets, duplicate invocation, serialization, legacy peers, invalid
ACKs, disconnect/reconnect, replacement/shutdown and draft/image preservation.
Run the synthetic Chromium/WebKit check against a static worktree build:

```sh
PLAYWRIGHT_MODULE=/tmp/fernblick-design-tools/node_modules/playwright/index.mjs \
  node tools/design/compact.mjs http://127.0.0.1:<static-port>
```

All API/SSE traffic is intercepted; no existing agents are controlled. It covers
320/390px phones, keyboard-height layout, portrait/landscape iPad and desktop,
toolbar order, unclipped top-layer overflow menu, keyboard navigation/select/Tab,
Escape/outside dismissal, unavailable reasons and stale-target invalidation,
confirmation/cancel focus, 44px targets, progress vs completion, draft/images
and viewport overflow.
Screenshots go to ignored `design-gallery/compact/`. Physical-device keyboard
behavior and live provider compaction remain manual verification.

HER-5 adds unit/socket/HTTP tests for per-session discovery, current-skill validation,
shadowed commands, legacy capability guards, stale replies, bounds and image
preservation. A subprocess with a private HOME runs the actual Pi 1.1.0 loader
across personal/project Pi and Agent Skills folders, repository ancestors,
configured paths and package resources. It verifies filtering, duplicate winners,
untrusted-project omission, explicit CLI paths under no-skills, and native skill
expansion with arguments/images while replacing the model-call boundary.

Run the synthetic browser regression separately (no live agents are controlled):

```sh
PLAYWRIGHT_MODULE=/tmp/fernblick-design-tools/node_modules/playwright/index.mjs \
  node tools/design/skills.mjs http://<dev-host>:<vite-port>
```

It intercepts every API request and substitutes the SSE connection. Chromium and
WebKit exercise 320/390px phones, a short keyboard-like viewport, iPad portrait and
desktop; assertions cover search, selection, keyboard/focus, explicit-only sends,
no-result/error Enter suppression, retry/empty/disconnect states, editor DOM
preservation on session changes, and layout. Screenshots go to the ignored
`design-gallery/skills/`. This does not substitute for physical-device IME or
software-keyboard testing.

`npm run check` includes strict compilation against pinned Pi 1.1.0 types,
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
HTTP tests cover all four formats, the original 10 MiB limit, ten-ID/image-only
requests and unsafe files. Restored image-only prompts retain their attachment IDs.

A real Pi 1.1.0 `createAgentSession`/SessionManager harness exercises
`sendUserMessage` → registered command dispatch → `navigateTree(user.id)`.
It verifies labels and active branch via real `getLeafId()`, user-to-root
navigation, and that both the agent prompt and model stream remain uncalled,
including an internal token that reaches the normal input guard.
The real navigation regression also registers a `session_tree` hook that
appends extension state, asserting that the root prompt still returns and old
branches remain intact. Destination-validation tests reject actual context
changes even behind a custom-entry tail. Optional installed-host verification:

```sh
PI_TREE_TEST_MODULE=/absolute/path/to/pi-coding-agent/dist/index.js \
PI_TREE_TEST_EXTENSION=/absolute/path/to/@plannotator/pi-extension/index.ts \
  npm test -- packages/pi-live-chat/extension.test.ts -t 'restores a root prompt through real Pi'
```

The optional extension case isolates `HOME` and loads only the named extension
beside this checkout's live-chat extension. Verified with Pi 1.3.0 and Plannotator
0.28.23: the old leaf-equality check rejects navigation, while ancestry validation
returns the prompt. Default CI uses the synthetic metadata hook and pinned Pi,
not an installed Plannotator dependency.

Tests do not call a provider or navigate existing user agents; browser layout
has not been manually exercised in this regression.

At the Pi 1.1.0 upgrade, `npm audit --package-lock-only` reports 19 findings
(3 low, 1 moderate, 11 high, 4 critical), compared with 20 on the previous lockfile.
The upgrade removes the `brace-expansion` finding and introduces no newly affected
packages; the other findings remain unresolved. The Pi dependency is for
type/loader verification, not imported by the backend at runtime. The standalone
extension's installed runtime dependency is Zod; Pi supplies the Pi AI peer. `npm run check` does not include `npm audit`.

The original conversation-tree and attachment-preview styles were restored
narrowly from commit `435eec2`, along with the tree button/composer column. No
dashboard, Terminal or shared-layout redesign was performed.
