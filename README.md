# Fernblick

A small mobile web controller for agents running inside Herdr. It connects to Herdr's local Unix socket, shows agent status and terminal text snapshots, and exposes a narrow set of controls.

## Requirements

- Linux with Herdr 0.9 or later
- Node.js 24 or later
- The backend must run as the same Unix user as the Herdr session
- Tailscale on the VPS and phone for private access

## Development

```bash
npm install
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

## Fernblick message queue

Messages composed in Fernblick are stored in a SQLite queue on the server, **not in Pi's native terminal queue**. Queued messages are visible across browser reloads/devices and survive server restarts. The dispatcher sends one message per agent session when Herdr reports it idle. It only marks delivery confirmed after finding a matching user message in Pi's transcript; a status change alone is not confirmation. If delivery cannot be confirmed within two minutes (including after a server crash), the queue stops and shows **uncertain**; check the conversation before choosing Retry (which may duplicate a delivered message) or Mark delivered. The queue is scoped to the agent pane and Pi session. If that pane starts a replacement session, its old messages remain visible for removal but will not be dispatched to the new session. Without an atomic session-conditional Herdr prompt operation, a replacement between the last identity check and send is still possible; do not rely on this queue to guard against simultaneous session replacement.

The database defaults to `~/.local/share/fernblick/queue.sqlite` and can be set with `FERNBLICK_DB_PATH` (use the same path for multiple Fernblick servers sharing a Herdr session). The database file is mode 0600 inside a mode 0700 directory. Back up the SQLite database using a SQLite-aware backup or after shutting down **all** Fernblick servers; copying only the `.sqlite` file while servers run in WAL mode can omit queued transactions. Idempotency records for delivered messages remain in the database so retried requests cannot send duplicates.

Images remain under `/tmp/fernblick`, not in SQLite; reboot or temporary-file cleanup may remove them. If an image is already missing at the pre-dispatch check, the message is **not** sent; delete it and queue it again without the missing image. A temporary file could still disappear between that check and Pi reading it.

## Available controls

- List detected agents and their Herdr status
- Read the latest 600 lines as plain terminal text
- Submit a normal agent prompt
- Send Escape, Ctrl+C, arrow keys, Enter, Tab, or Shift+Tab

The HTTP API does not expose a shell or arbitrary Herdr method proxy. Access to this application still grants effective control of the agents, which may execute commands and modify files with their Unix account's permissions.

## Configuration

| Variable            | Default                                 | Purpose                     |
| ------------------- | --------------------------------------- | --------------------------- |
| `HOST`              | `127.0.0.1`                             | Address for the HTTP server |
| `PORT`              | `8787`                                  | HTTP port                   |
| `HERDR_SOCKET_PATH` | `~/.config/herdr/herdr.sock`            | Herdr session socket        |
| `FERNBLICK_DB_PATH` | `~/.local/share/fernblick/queue.sqlite` | SQLite queue location       |

## Checks

```bash
npm run check
```
