# Fernblick

A small mobile web controller for agents running inside Herdr. Dashboard and Terminal use Herdr; live Pi Chat uses a standalone in-process Pi extension, a private Unix socket, and browser SSE.

## Interface

React 19 and TypeScript, built with Vite. The light-blue interface is smartphone-first, with single-pane navigation on portrait iPads and a persistent workspace sidebar on landscape iPads and desktop. All styles use CSS Modules; icons are custom SVGs and Manrope is bundled locally, with no external font requests.

Manrope is licensed under the SIL Open Font License 1.1. Its complete copyright notice and license ship at `/licenses/Manrope-OFL.txt`; see [font provenance](src/styles/fonts/README.md). See [styling and development conventions](docs/development.md) and the [three-viewport screenshot gallery tooling](tools/design/README.md).

## Requirements

- Linux with Herdr 0.9 or later
- Node.js 24 or later
- Interactive Pi 0.99.1 with the [standalone live-chat extension](packages/pi-live-chat/README.md) for Chat
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
installing a standalone copy. Fernblick never changes your global Pi configuration.
Created agents load that same extension explicitly; set `FERNBLICK_PI_GLOBAL=1`
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
Stop invokes Pi's abort method and then observes events. Attach up to four PNG,
JPEG, GIF or WebP images (10 MiB each), including image-only messages. Conversation
paths restore search, filters, labels, active-branch display and edit-and-branch,
including available images from a restored prompt. Tree data and navigation use
the direct Pi bridge, never session-file reads or terminal command injection.

### Removed legacy queue

The Fernblick SQLite queue, dispatcher, HTTP routes, UI and guarded delivery
command have been removed. **Existing `queue.sqlite`, WAL/SHM files and old uploads
are left untouched.** Nothing reads, migrates, deletes or automatically sends those
messages, and `FERNBLICK_DB_PATH` is no longer used. If you want to recover old
drafts, inspect a backup manually; do not expect them to be delivered.
No Pi-native queue was added.

## Available controls

- List detected agents and their Herdr status
- Read the latest 600 lines as plain terminal text
- Stream ordinary Pi model chat, thinking and tool output; send idle text prompts and request Stop
- Send terminal keys only from Terminal view
- Toggle **Annotate** in Chat to comment on selected assistant text, then send the pending comments directly without changing the ordinary draft. [Interaction and limitations](docs/annotation-mode.md).

The HTTP API does not expose a shell or arbitrary Herdr method proxy. Access to this application still grants effective control of the agents, which may execute commands and modify files with their Unix account's permissions.

## Configuration

| Variable               | Default                                 | Purpose                                                               |
| ---------------------- | --------------------------------------- | --------------------------------------------------------------------- |
| `HOST`                 | `127.0.0.1`                             | Address for the HTTP server                                           |
| `PORT`                 | `8787`                                  | HTTP port                                                             |
| `HERDR_SOCKET_PATH`    | `~/.config/herdr/herdr.sock`            | Herdr session socket                                                  |
| `FERNBLICK_PI_SOCKET`  | `~/.local/share/fernblick/live/pi.sock` | Private Pi bridge socket (also configure Pi)                          |
| `FERNBLICK_UPLOAD_DIR` | `/tmp/fernblick`                        | Shared private upload directory; configure backend and Pi identically |
| `FERNBLICK_PI_GLOBAL`  | unset                                   | Set to `1` to use a globally installed extension for created agents   |

## Checks

```bash
npm run check
```
