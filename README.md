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

## Available controls

- List detected agents and their Herdr status
- Read the latest 600 lines as plain terminal text
- Submit a normal agent prompt
- Send Escape, Ctrl+C, arrow keys, Enter, Tab, or Shift+Tab

The HTTP API does not expose a shell or arbitrary Herdr method proxy. Access to this application still grants effective control of the agents, which may execute commands and modify files with their Unix account's permissions.

## Configuration

| Variable            | Default                      | Purpose                     |
| ------------------- | ---------------------------- | --------------------------- |
| `HOST`              | `127.0.0.1`                  | Address for the HTTP server |
| `PORT`              | `8787`                       | HTTP port                   |
| `HERDR_SOCKET_PATH` | `~/.config/herdr/herdr.sock` | Herdr session socket        |

## Checks

```bash
npm run check
```
