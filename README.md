# Fernblick

A small mobile web controller for agents running inside Herdr. Dashboard and Terminal use Herdr; live Pi Chat uses a standalone in-process Pi extension, a private Unix socket, and browser SSE.

## Interface

React 19 and TypeScript, built with Vite. The light-blue interface is smartphone-first, with single-pane navigation on portrait iPads and a persistent workspace sidebar on landscape iPads and desktop. Fernblick styles use CSS Modules; icons are custom SVGs and Manrope is bundled locally, with no external font requests. The lazy-loaded Excalidraw whiteboard uses its vendor stylesheet and locally served fonts.

When creating an agent, **Create a new workspace** keeps the agent draft intact.
Creating the workspace returns to that draft with the new workspace selected;
canceling returns without changing the selection. Confirm **Create agent** to
start Pi. Standalone workspace creation still creates only a workspace and shell.
New shell tabs also accept an optional name; leave it blank to use Herdr's next
tab number.

Opening an agent's **New answer** in a visible browser tab saves a Fernblick read
receipt and displays **Idle**, including its workspace badge. Receipts survive
page reloads and Fernblick backend restarts and are shared by browsers using the
same backend storage. Polling does not bring back the same badge; a later answer
is unread again. Herdr's underlying status, focus, and native UI receipts are
never changed. Answers arriving in a hidden browser tab remain unread until you
return. Failed saves keep the answer unread and offer **Retry**.

Receipts are private, immutable marker files in `FERNBLICK_READ_RECEIPT_DIR`
(default `~/.local/share/fernblick/read-receipts`); use a persistent volume when
running in a container. The directory must be owned by the backend user, mode
0700, and not symlinked. Receipts are shared, not per-user (Fernblick has no
separate reader accounts). Each marker identifies a Herdr socket generation,
pane/terminal, agent session, and completion sequence. A cold Herdr restart or
socket replacement establishes a new namespace so reused IDs cannot hide new
answers. On each successful dashboard refresh, Fernblick removes receipts for
superseded answers, closed agents, and older generations of that configured
Herdr socket. Current receipts do not expire with age. Cleanup skips other
socket namespaces, unrecognized files, and symlinks; it never treats an
unavailable Herdr as an empty session. When no browser is polling, cleanup waits
until the next dashboard request. Manually deleting current markers resets
Fernblick's read history. No conversation text is stored in receipts.

Manrope is licensed under the SIL Open Font License 1.1. Its complete copyright notice and license ship at `/licenses/Manrope-OFL.txt`; see [font provenance](src/styles/fonts/README.md). See [styling and development conventions](docs/development.md) and the [three-viewport screenshot gallery tooling](tools/design/README.md).

## Requirements

- Linux with Herdr 0.9 or later
- Node.js 24 or later
- Interactive Pi 1.1.0 with the [standalone live-chat extension](packages/pi-live-chat/README.md) for Chat
- The backend must run as the same Unix user as the Herdr session
- Tailscale on the VPS and phone for private access

## Development

```bash
npm ci
npm run dev
```

The frontend runs at `http://127.0.0.1:5173` and proxies API calls to the backend on port 8787.

## Production

Build and start the application:

```bash
npm run build
HOST="$(tailscale ip -4)" npm start
```

Then open `http://<vps-magicdns-name>:8787` from a device on the same tailnet. Restrict TCP port 8787 to your user or phone in the tailnet policy. Do not expose this port to the public internet.

### Install as an app (PWA)

Use HTTPS for installation and service-worker support. For a new deployment,
prefer a loopback-only backend and private Tailscale Serve:

```bash
HOST=127.0.0.1 npm start
# In another terminal; check that the HTTPS port is unused first:
tailscale serve --bg --https=4445 http://127.0.0.1:8787
```

Open the HTTPS URL reported by Serve directly in Chrome on Android, then use
**Install app** (or **Add to Home screen**) from the browser menu. On iOS/iPadOS,
open it in Safari and use **Share → Add to Home Screen**. The installed app is
named **Fernblick** and uses its Scout sheep-head icon on pale blue. Do not install from an
embedded browser opened by another app.

The current VPS endpoint is
`https://hetzner-vps.tail6b5377.ts.net:4445/`; its existing Serve mapping points
at the already-running backend on `100.71.229.1:8787`. Changing that backend to
loopback requires changing the proxy target too. Shelf stays on port 4444.

The Scout artwork has transparent head/full-logo masters, solid home-screen
icons, dedicated favicons and a separately padded maskable icon. The full logo
with playful lettering appears only while the first dashboard request loads;
there is no artificial splash delay. System launch screens remain controlled by
the browser/OS. Existing installations may update their home-screen artwork later
than the app; a shortcut reinstall may be necessary on some platforms. See
[branding assets](design/branding/README.md).

Different ports isolate service workers and browser storage, but Android's
external-link routing can still associate a link with another installed app.
Verify home-screen launch separately from links opened by other apps.

Serve is tailnet-only; do not use Funnel. HTTPS uses a publicly trusted certificate,
whose hostname is public in certificate-transparency logs, not public app access.
Keep tailnet access rules restricted to the intended users/devices.

After a successful online visit and worker installation, the frontend shell can
open offline. Agent lists, chat, API responses, uploaded images and drawings are
**not** added to the service-worker cache. Existing whiteboard local-draft storage
is unchanged. Offline startup shows a connection notice; using agents still needs
the backend and tailnet. No background command queue or notifications are added.

Updates download in the background and offer **Refresh app** / **Later**. Finish
drafts in all open windows before refreshing: refresh reloads that window and can
discard unsent text or images. Another window accepting an update never forces
this window to reload. Foregrounding and reconnecting check for updates; a mobile
OS may suspend connections while the app is backgrounded.

Changing the HTTPS port or hostname creates a different browser origin. Install
from the final URL; local data and permissions do not migrate automatically.
Service workers are disabled in Vite development; test a production build on
localhost or HTTPS.

The default Herdr socket is `~/.config/herdr/herdr.sock`. For a named session, set it explicitly:

```bash
HERDR_SOCKET_PATH="$HOME/.config/herdr/sessions/<name>/herdr.sock" \
  HOST="$(tailscale ip -4)" \
  npm start
```

## Pi live chat

Install the standalone extension **yourself** for ordinary CLI Pi agents:

```sh
pi install /absolute/path/to/herdr-fernblick/packages/pi-live-chat
```

Then start Pi or reload it yourself. This local-path installation requires the
checkout's `npm ci`; see the [package README](packages/pi-live-chat/README.md) for
installing a standalone copy. Fernblick does not install or reconfigure Pi automatically.
The explicit **Set as global default** star action saves only model/provider or
thinking defaults in Pi's global settings. Created agents load that same extension explicitly; set `FERNBLICK_PI_GLOBAL=1`
on the backend to omit explicit loading when installed globally.

The extension connects persistently to
`~/.local/share/fernblick/live/pi.sock`. Set `FERNBLICK_PI_SOCKET` consistently on
both the backend and Pi/Herdr environment for a separate instance. No additional
TCP port is opened. [Protocol, safety, and limitations](docs/pi-live-chat.md).

Chat uses public Pi branch history and live events, **not JSONL files, pane text,
or footer scraping**. Busy/concurrent sends are rejected; there is no queue.
An ACK means only that Pi's void send method was invoked, not guaranteed
acceptance. The browser clears text and images when forwarding is acknowledged,
without waiting for a Pi receipt or comparing message text. Failed or uncertain
forwarding keeps the visible draft; there is no hidden recovery copy or automatic
retry. Pi's working/idle state gates the next send independently.
Stop invokes Pi's abort method and then observes events. Attach up to ten PNG,
JPEG, GIF or WebP images (10 MiB each), including image-only messages. Tap a draft
thumbnail or a sent image to preview that batch in a gallery; use Previous/Next or
Left/Right arrow keys to cycle, and Escape or Close to return without changing the draft. Conversation
paths page long histories with short previews, whole-session search, labels and
explicit branch exploration. Paging and viewing another path do not change Pi’s
active conversation. **Edit and branch** restores the full prompt and available
images. Existing Pi sessions need `/reload` for paged paths; older peers show a
reload notice. [Paging and limits](docs/conversation-paths.md). Tree data and navigation use
the direct Pi bridge, never session-file reads or terminal command injection.

### Local images in chat

Markdown images can refer to an absolute path on the VPS:
`![Logo](/tmp/logo.png)`, or a path relative to the Pi session's working directory:
`![Preview](./design/preview.png)`, `![Preview](design/preview.png)` or
`![Preview](../preview.png)`. For spaces, use `![Logo](<./logo draft.png>)`.

Chat and whiteboard resolve relative paths against the working directory reported
by Pi, never the browser URL or the Fernblick server's working directory. If that
directory is unavailable, relative image syntax stays literal; absolute paths still
work. Resolution uses the current session directory, not a per-message historical
directory, so changing that context can change what an older relative path shows.
Use absolute paths for unambiguous references across directory changes.

Fernblick reads the original file through its existing backend and shows it in
chat with the normal image preview. **It does not copy the file or create an
attachment.** Each new request reads the current file; moved, deleted or unreadable
files show as unavailable. Files are not watched for live changes.

Any directory the backend user can read is supported, including symlinks. This
makes local images accessible to people with access to your private Fernblick
instance; keep it tailnet-only. Only PNG, JPEG, GIF and WebP content up to 10 MiB
is served, with no browser caching and cross-origin embedding blocked. SVG, local
`file:` URLs, network paths (`//host/...`) and tilde expansion (`~/...`) are
unsupported. Only Markdown image destinations are resolved; plain paths, ordinary
links and code examples are not loaded. Paths
refer to the backend VPS, not your phone or another agent machine.

### Past sessions

Open **Past sessions** in the sidebar to search saved Pi conversations by title, first
message, or project path. Only closed conversations are shown, ordered by most
recently modified; find open conversations in **Agents** or **Workspaces**. Click a
session's **Resume** button, choose a workspace in the dialog, then confirm **Resume**
to start Pi in a new tab in the original project directory,
with the original session and conversation context. **Create new workspace** is
always available in this dialog, with the session's original directory and a suggested
name prefilled. Creating one returns to the same session with the new workspace
selected; confirm **Resume** to launch Pi. Canceling creation returns to the
workspace choice without launching anything. A resumed session leaves the list
immediately. If a session was opened after the list loaded, Resume selects that
existing agent instead of starting a duplicate. Resuming does not send a prompt.
The original project directory must still exist.

**Restart session** uses Pi’s live shutdown API, not a typed terminal command.
It refuses to restart while Pi is busy or its terminal editor contains an unsent
draft. Save that text elsewhere and clear the terminal editor before retrying;
restart never submits or discards it. Existing Pi sessions need a manual `/reload`
to enable safe restart. The browser composer is separate and remains untouched.

Use a session's **Delete** button and confirm **Delete session** to permanently remove
its saved session file, associated whiteboards (including embedded assets and saved
snapshots), and referenced image uploads not shared with another saved session.
Whiteboard drafts and recovery copies in this browser are cleared too; a warning
appears if local cleanup fails. Project files, other conversations/forks and
resources still referenced by them are kept. This cannot be undone. Cancel leaves
the session untouched; deletion errors stay in the dialog so you can retry. A
“Session removed” snackbar confirms successful deletion, dismisses after six
seconds, and can be closed manually. Its timer pauses while hovered or focused. Active
sessions, sessions currently being resumed, and deletion while a Pi agent's session
identity is unknown are blocked.

Cleanup checks other conversations in the configured session store. It cannot
erase copies in other stores, other browsers/devices, backups, downloaded files
or previously cached images. Uploads from canceled/failed requests with no saved
conversation association cannot be safely attributed and are not swept globally.
Legacy whiteboards without ownership metadata can be found using the current
Herdr socket; boards opened with this version also record ownership privately so
cleanup can find them after a socket-path change.

Cleanup is retryable, not an atomic transaction across all files: a failure may
leave the transcript with some associated files already removed. The transcript
is staged in a private `.fernblick-delete-*` directory beside its original file
during cleanup and restored on failure without overwriting new sessions. If the
backend stops mid-cleanup, that directory preserves the session for manual recovery
or completion of deletion. Small private ID-only deletion receipts are retained so
retrying after a lost response or backend restart can finish browser-draft cleanup;
receipts contain no transcript, drawing or image content. Cleanup fails closed if
another nonempty session is unreadable or invalid and sharing cannot be checked.
Readable zero-byte session placeholders are ignored by the sharing scan and left
untouched; they contain no conversation or asset references.

The backend reads session-file metadata for this list only; the live transcript
still comes from Pi's live bridge. It discovers local sessions under
`~/.pi/agent/sessions` (or `PI_CODING_AGENT_DIR/sessions`). Set
`FERNBLICK_PI_SESSION_DIR` to an absolute directory to browse a different session
store; `PI_CODING_AGENT_SESSION_DIR` is also recognized. Both flat stores and Pi's
one-level project grouping are supported. Custom Pi CLI/settings directories are
not discovered automatically. Symlinked entries and invalid session headers are
ignored; missing stores show an empty list. Past sessions appear as cards and refresh
automatically every 30 seconds while visible. A retry action appears if loading fails.

This exposes saved-session titles, prompt previews and project paths for the backend's
Unix user, not just sessions created through Fernblick. Use a dedicated session
directory for isolated development. Active-session detection is limited to the
connected Herdr instance: do not resume a file that is open in another Herdr
instance or standalone Pi process. The same limitation applies to deletion: close
a session in all other instances before deleting it. Session files are only removed
after an explicit delete confirmation; browsing never rewrites them.

### Whiteboard

Open **Whiteboard** from live Chat for a fullscreen, persistent Excalidraw canvas. Its chat panel uses the same transcript as main chat: side-by-side on landscape tablet/desktop, compact and expandable below the canvas on smaller screens. Type there to send a current board image with read/edit access for that request (empty boards skip the image). Share drawing sends an immutable image-only PNG snapshot. Agent tools are hidden by default and backend-authorized; editing access ends on completion, revocation, disconnect, or expiry. Native scenes remain editable after sending. [Permission, persistence, conflicts, and limits](docs/whiteboard.md).

### Skills

Use the **/Skills** button in the composer toolbar to search
by name or description. Arrow keys select; Enter or Tab inserts `/skill:name` into
the draft. Add instructions or images, then send when Pi is idle. Escape dismisses
the picker without changing the draft. Typing `/` does not open the picker; you can
still type a `/skill:name` invocation manually.

The list comes from the selected Pi session, not a backend directory scan. It
includes the skills Pi actually loaded from personal/project `.pi` and `.agents`
folders, configured paths, packages and explicit CLI resources. Source paths and
scope are shown in the picker. Pi owns trust, filtering and duplicate precedence.
After updating the bridge or changing skills, run `/reload` in Pi. Other agent
providers are not yet supported by live chat or the skills picker.

### Model and thinking level

Open the composer's three-dot menu for **Model**, **Thinking level**, and **Tree**.
Each has an icon beside its label. Model opens a searchable list of the selected
agent's available models. Thinking level offers only levels supported by its
current model. Changes apply to that agent's session, not defaults for new agents,
and leave the conversation, draft and images intact. Pi must be idle to change
these settings. Each row has a star to save that choice as the global default
without switching the session or closing the dialog. The saved choice shows a
filled star and **Default** on the right, independently of **Current**. Defaults
are read from Pi when the dialog opens and apply to newly launched sessions,
including outside Fernblick. Project, per-model and explicit launch overrides
still apply; running sessions stay unchanged. Existing agents need `/reload`
after the bridge update.

### Removed legacy queue

The Fernblick SQLite queue, dispatcher, HTTP routes, UI and guarded delivery
command have been removed. **Existing `queue.sqlite`, WAL/SHM files and old uploads
are left untouched.** Nothing reads, migrates, deletes or automatically sends those
messages, and `FERNBLICK_DB_PATH` is no longer used. If you want to recover old
drafts, inspect a backup manually; do not expect them to be delivered.
No Pi-native queue was added.

## Available controls

- List detected agents and their Herdr status
- Search saved Pi chats and resume them in a workspace
- Show the current terminal screen as plain text, refreshed every second
- Load up to 600 lines of terminal history on demand when the agent is idle. History is a scrollable snapshot; **Return to live** resumes the current screen. Shell history can also be loaded, subject to Herdr's safe-read restrictions.
- Stream ordinary Pi model chat, thinking and tool output; send idle text prompts and request Stop
- Send terminal keys only from Terminal view
- Select assistant text in Chat, tap **Comment**, then send the pending comments directly without changing the ordinary draft. No annotation mode is required. [Interaction and limitations](docs/annotation-mode.md).

The HTTP API does not expose a shell or arbitrary Herdr method proxy. Access to this application still grants effective control of the agents, which may execute commands and modify files with their Unix account's permissions.

## Configuration

| Variable                     | Default                                  | Purpose                                                                    |
| ---------------------------- | ---------------------------------------- | -------------------------------------------------------------------------- |
| `HOST`                       | `127.0.0.1`                              | Address for the HTTP server                                                |
| `PORT`                       | `8787`                                   | HTTP port                                                                  |
| `HERDR_SOCKET_PATH`          | `~/.config/herdr/herdr.sock`             | Herdr session socket                                                       |
| `FERNBLICK_PI_SOCKET`        | `~/.local/share/fernblick/live/pi.sock`  | Private Pi bridge socket (also configure Pi)                               |
| `FERNBLICK_UPLOAD_DIR`       | `/tmp/fernblick`                         | Shared private upload directory; configure backend and Pi identically      |
| `FERNBLICK_PI_SESSION_DIR`   | Pi session directory (see Past sessions) | Backend-only saved-chat discovery root; use an absolute path               |
| `FERNBLICK_PI_GLOBAL`        | unset                                    | Set to `1` to use a globally installed extension for created agents        |
| `FERNBLICK_BOARD_DIR`        | `~/.local/share/fernblick/boards`        | Private persistent whiteboard scenes and sent snapshots                    |
| `FERNBLICK_READ_RECEIPT_DIR` | `~/.local/share/fernblick/read-receipts` | Private persistent read receipts shared by Fernblick browsers              |
| `FERNBLICK_API_TARGET`       | `http://127.0.0.1:8787`                  | Vite development API proxy target                                          |
| `FERNBLICK_PI_ISOLATED`      | unset                                    | Set to `1` to disable auto-discovered Pi extensions for development agents |
| `FERNBLICK_HERDR_EXTENSION`  | unset                                    | Herdr state extension path to explicitly retain with isolated Pi loading   |

## Checks

```bash
npm run check
```

Includes formatting, lint, both Knip modes, typechecking, tests and the production
build. Run dead-code checks separately with `npm run knip` (including tests and
tooling) or `npm run knip:production` (runtime reachability without tests/stories).

`knip.jsonc` declares the backend and standalone Pi extension entry points;
plugins discover the frontend, service worker, tests and Storybook. Test fixtures
are excluded only in production mode. Helpers called inside their own file are
not considered dead just because only tests import them. The two intentionally
Storybook-only components have documented `@internal` exceptions; normal mode
still checks their usage. Review findings before deleting implementations or
their tests—an unused export is not necessarily unused code. These checks do not
prove that deployment artifacts contain no test code.

Read-status regression (Chromium/WebKit at phone, tablet and desktop sizes;
all API and SSE traffic is synthetic):

```sh
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs \
  node tools/design/read-agent-status.mjs http://127.0.0.1:<frontend-port>
```

Agent/workspace dialog regression (Chromium/WebKit at phone, tablet and desktop
sizes; all API requests are intercepted with synthetic fixtures):

```sh
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs \
  node tools/design/agent-workspace.mjs http://127.0.0.1:<frontend-port>
```

Saved-chat browser regression (Chromium/WebKit at phone, tablet and desktop sizes;
all agent APIs are synthetic fixtures):

```sh
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs \
  node tools/design/chat-history.mjs http://127.0.0.1:<frontend-port>
```
