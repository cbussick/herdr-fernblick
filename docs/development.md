# Development isolation

Fernblick's state comes from a Herdr Unix socket and Pi sessions; two servers pointing at the same socket control the **same agents**. For truly isolated agent stacks, start a separate Herdr session/pod for each worktree and point `HERDR_SOCKET_PATH` at that session's socket. Confirm the session is distinct before sending commands through Fernblick. Protect sockets and uploads as sensitive local data.

Each worktree has its own dependencies, Vitest invocation and ignored build outputs. Run `npm ci` and `npm run check` from inside each worktree. Avoid simultaneous test commands in the **same** worktree.

The backend listens on `HOST` / `PORT` (defaults: loopback / 8787). Assign a distinct loopback `PORT` to each concurrent server. The current Vite development proxy in `vite.config.ts` is fixed to port 8787; changing only `PORT` or Vite's `--port` does **not** isolate API traffic. Until the proxy is made configurable, run only one `npm run dev` stack at a time, or build each worktree and serve it on a distinct port instead:

```sh
npm ci
npm run check
PORT=<unique-port> HERDR_SOCKET_PATH=<this-worktree-session-socket> npm run build
PORT=<unique-port> HERDR_SOCKET_PATH=<this-worktree-session-socket> npm start
```

Use distinct, verified Herdr sockets for independent sessions; merely using different web ports does not isolate the Herdr agents. `npm start` uses the built static frontend and backend from that worktree. Keep `HOST` on loopback unless the access restrictions described in the README are in place. Stop a stack using its owning terminal/process, not a copied PID from another worktree.
