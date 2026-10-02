# Development isolation

Fernblick's state comes from a Herdr Unix socket and Pi sessions; two servers pointing at the same socket control the **same agents**. For truly isolated agent stacks, start a separate Herdr session/pod for each worktree and point `HERDR_SOCKET_PATH` at that session's socket. Confirm the session is distinct before sending commands through Fernblick. Protect sockets and uploads as sensitive local data.

## Styling

Use CSS Modules (`*.module.css`) for all application and Storybook styles. Import module maps and pass their exported class names to JSX; do not introduce literal/global component classes. `npm run lint` enforces these conventions.

Modules are grouped by responsibility: application layout, overview, console, dialogs, conversation paths, shared UI and accessibility utilities. Use scoped parent selectors with explicit `data-ui` contracts to position shared child components; browser tests use stable `data-testid` hooks, never generated class names. Document-level resets and the font-face are the only global application rules. The theme and document module classes are applied to `<html>` in the app and Storybook entry points; keep these bound imports so Vite retains them in production.

Manrope is locally bundled under the SIL OFL 1.1. Preserve the full notice in both `src/styles/fonts/Manrope-LICENSE.txt` and the distributed `public/licenses/Manrope-OFL.txt`; see [font provenance](../src/styles/fonts/README.md).

## Worktree runtime

Each worktree has its own dependencies, Vitest invocation and ignored build outputs. Run `npm ci` and `npm run check` from inside each worktree. Avoid simultaneous test commands in the **same** worktree.

The backend listens on `HOST` / `PORT` (defaults: loopback / 8787). Assign a distinct loopback `PORT` to each concurrent server. Vite's proxy uses `FERNBLICK_API_TARGET` (default `http://127.0.0.1:8787`) and preserves the browser Host for backend Origin checks. Set it explicitly when changing the API port; changing only Vite's `--port` does **not** isolate API traffic. Vite uses a strict port and will fail rather than silently move to another port.

For a separate development stack, set `PORT=<unique-api-port>` for `npm run dev:api`, then `FERNBLICK_API_TARGET=http://127.0.0.1:<unique-api-port> npm run dev:web -- --port <unique-web-port>`. Use `--host <tailnet-ip>` only with the access restrictions described in the README. Alternatively, build each worktree and serve it on a distinct port:

```sh
npm ci
npm run check
PORT=<unique-port> HERDR_SOCKET_PATH=<this-worktree-session-socket> npm run build
PORT=<unique-port> HERDR_SOCKET_PATH=<this-worktree-session-socket> npm start
```

Use distinct, verified Herdr sockets for independent sessions; merely using different web ports does not isolate the Herdr agents. Also set a distinct `FERNBLICK_PI_SOCKET` for each backend and its Pi/Herdr environment (see [live chat](pi-live-chat.md)); backend-only environment changes do not propagate to agents spawned by Herdr. Each socket needs its own private 0700 directory. Set distinct `FERNBLICK_UPLOAD_DIR` and `FERNBLICK_BOARD_DIR` directories too; the board directory must be private and non-symlinked. Tests use isolated fixtures, never existing user agents.

For isolated Pi agents created from the development UI, `FERNBLICK_PI_ISOLATED=1` disables automatically discovered extensions and explicitly loads this checkout's live-chat extension. Set `FERNBLICK_HERDR_EXTENSION` to the installed Herdr state integration (typically `~/.pi/agent/extensions/herdr-agent-state.ts`) to explicitly retain session/status reporting. Without that integration, a new agent may not advertise its saved session to Fernblick. This avoids a globally installed live-chat extension from another checkout taking singleton ownership. The normal launch path is unchanged when isolation is unset; no global Pi settings need editing. `npm start` uses the built static frontend and backend from that worktree. Keep `HOST` on loopback unless the access restrictions described in the README are in place. Stop a stack using its owning terminal/process, not a copied PID from another worktree.
