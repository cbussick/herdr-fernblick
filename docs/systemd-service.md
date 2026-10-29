# Run Fernblick as a systemd service

This is a **prepared deployment procedure**, not evidence that the service is installed. Review the generated files and get approval for the specific release/cutover before installing, enabling or restarting anything. Do not reboot the shared host to test this without separate approval.

## Choice and prerequisites

Use a **system service with an explicit User/Group**, rather than a user service. It starts through `multi-user.target` without a login or lingering, and supports a dedicated journal namespace. The inspected deployment currently runs as root because its Herdr/Pi processes do; this procedure preserves that existing trust boundary, not a recommendation to run every installation as root. Moving Herdr/Pi to another Unix user is separate work.

Requirements: Linux/systemd with journal namespace support (systemd 245+, verified here with 259), Node 24 at a fixed absolute executable path, built Fernblick, and the existing Herdr/Tailscale setup. This service does **not** install/start Herdr, start agents, migrate storage, configure Tailscale Serve, open firewall ports or install automatic updates.

Files:

- `deploy/systemd/fernblick.service.in`: reviewed system-service template.
- `deploy/systemd/fernblick.env.example`: placeholder configuration, **not ready to install unchanged**.
- `deploy/systemd/journal-retention.conf`: limits only the `fernblick` journal namespace, not other services' logs.
- `npm run service:render`: pure renderer; prints a unit, never installs or starts it. Use `--silent` when redirecting output.
- `tools/systemd/wait-host.mjs`: startup-only preflight; waits up to two minutes for the configured local IP, so a Tailnet address can appear after early boot. It never changes networking or touches Herdr.

The generator deliberately accepts only normalized absolute paths made of letters, digits, `_`, `.`, `/`, `-`, and simple Unix user/group names. It rejects newlines, whitespace, quotes, `$`, `%` and unit/shell substitutions. If your installation needs other path syntax, review a manually escaped unit instead of weakening validation blindly.

## 1. Inventory without disrupting the running app

Identify the actual listener immediately before cutover, not a saved PID from a previous session:

```sh
ss -ltnp 'sport = :8787'
# With the PID confirmed from that listener:
readlink /proc/CONFIRMED_PID/exe
readlink /proc/CONFIRMED_PID/cwd
ls -l /proc/CONFIRMED_PID/fd/1 /proc/CONFIRMED_PID/fd/2
```

Privately verify the backend/Herdr Unix user/group, absolute checkout and Node binary, HOME, required PATH entries, HOST/PORT, socket paths, existing board/receipt/upload/session/cache locations, public/render URLs and any explicit Pi options. Inspect only relevant non-secret settings; do not dump the entire environment, credentials or user sessions into a report. Record the old launcher/command and per-deployment log path for rollback. Check socket/directory ownership without reading chat data.

**Preserve current values.** In the 2026-10-29 inspection, the backend used the primary checkout and Tailnet address `100.71.229.1:8787`; the documented existing HTTPS Serve mapping points there. Changing HOST to the example's `127.0.0.1` without separately changing that mapping would break access. Do not alter that mapping or bind `0.0.0.0`/`::` during this migration. Preflight requires a specific local IP; the operator must choose a reviewed loopback/Tailnet address, never a public interface.

Keep exactly the existing Herdr/Pi socket paths and shared upload directory. Existing Pi agents will not receive environment changes made only on the backend. A missing Herdr socket is not a reason to create another Herdr session. Preserve needed Node/Pi/provider PATH/configuration explicitly; system services do not source interactive shell profiles or run `nvm use`.

## 2. Prepare and verify files (no installation/start yet)

Set these shell variables to the **confirmed** values, not guesses: `SERVICE_USER`, `SERVICE_GROUP`, `SERVICE_HOME`, `CHECKOUT`, `NODE`, and `ENV_FILE` (recommended `/etc/fernblick/fernblick.env`). Render from the task checkout:

```sh
umask 077
UNIT_DIR=$(mktemp -d)
npm run --silent service:render -- \
  --user "$SERVICE_USER" --group "$SERVICE_GROUP" --home "$SERVICE_HOME" \
  --workdir "$CHECKOUT" --node "$NODE" --environment-path "$ENV_FILE" \
  > "$UNIT_DIR/fernblick.service"
systemd-analyze verify --man=no "$UNIT_DIR/fernblick.service"
```

The unit invokes the pinned Node directly, with the confirmed working directory and HOME. Its base PATH includes that Node directory, `$SERVICE_HOME/.local/bin` and standard system bins; override PATH in the private environment file when the existing setup needs more. Never include credentials in renderer arguments or the unit itself.

Prepare a private copy of the example and replace every placeholder with actual values. EnvironmentFile uses **literal absolute values**, not shell expansion: no `$HOME`, `~`, command substitution or `export`. Preserve all required existing settings, including optional values not shown by the example. Keep the reviewed file out of Git and support attachments. The required environment file is not optional: missing/unreadable configuration must fail startup, not silently select a different Herdr session.

Use stable existing data directories outside deployment/build outputs. Ensure required private 0700 socket/board/receipt directories retain the same owner and do not introduce symlinks. HER-20's `FERNBLICK_LOG_DIR` is a separate private application history; keep its directory across deploys. On builds without HER-20 that setting has no effect.

Run the task's checks/build in its isolated worktree. The backend must not be running against dependency/build files being replaced. Verify the actual Node executable and Playwright browser installation are available as the service user; an NVM-managed binary is fine when its absolute version path is retained.

## 3. Approved installation and cutover

Only after approval of the named release and downtime:

1. Preserve the old launcher, built release and old deployment logs. Confirm the current listener still belongs to the process you intend to replace. Do not use `pkill node`, copied PIDs or blanket socket removal.
2. Install the **reviewed** private environment file and unit, without starting them:

   ```sh
   sudo install -d -m 0700 /etc/fernblick
   sudo install -o root -g root -m 0600 /path/to/reviewed.env /etc/fernblick/fernblick.env
   sudo install -o root -g root -m 0644 "$UNIT_DIR/fernblick.service" /etc/systemd/system/fernblick.service
   sudo install -d -m 0755 /etc/systemd/journald@fernblick.conf.d
   sudo install -o root -g root -m 0644 deploy/systemd/journal-retention.conf \
     /etc/systemd/journald@fernblick.conf.d/retention.conf
   sudo systemctl daemon-reload
   ```

   The system manager reads the root-owned 0600 environment file before running the configured service user. Do not grant general users access to it. Adapt install paths if the renderer's confirmed ENV_FILE differs.

3. Stop the old backend through its owning launcher/terminal (or a freshly verified process identity). **Do not stop Herdr or existing Pi agents.** Confirm port 8787 is free and the old backend is gone before starting the new one; both backends would otherwise contend for the same listener/Pi bridge.
4. Put only the approved, tested release in the configured checkout and build it with the pinned Node; do not build over a live backend. Do not change tracked production files or integrate a branch without approval under the repository workflow.
5. `sudo systemctl start fernblick.service`. Check status and logs below, then HTTP/Herdr readiness. `Type=exec` means the executable started, not that the API is ready. A missing/broken Herdr session returns 503 while Fernblick stays up; once the same configured socket is available, later requests recover without an agent command or another Herdr server.
6. Test a phone through the **unchanged** HTTPS URL. Confirm only one backend listener, correct assets/build, connection to the intended Herdr session and expected saved history. Do not send prompts, restart agents or dismiss real unread answers just to test deployment.
7. Only after health checks pass, `sudo systemctl enable fernblick.service`. Verify `is-enabled` and the `multi-user.target` dependency; boot execution is not proven until a separately approved reboot test. This system service needs no user lingering.

The unit waits up to 120 seconds for its configured HOST address, with a 150-second startup budget, and orders after network-online/tailscaled when present. It restarts on failure after five seconds, with at most five starts in a 120-second window. Repeated immediate configuration failures stop instead of spinning. After fixing them: `sudo systemctl reset-failed fernblick.service`, then start it. It has a 20-second stop deadline and stops only its cgroup, including renderer children—not the pre-existing Herdr/Pi processes outside it. No broad home/tmp/proc isolation is added here because it could hide required sockets, files or process identity checks; future hardening needs separate integration tests.

## Operation and health

```sh
sudo systemctl start fernblick.service
sudo systemctl stop fernblick.service
sudo systemctl restart fernblick.service
systemctl status fernblick.service --no-pager
systemctl is-enabled fernblick.service
systemctl show fernblick.service -p User -p Group -p WorkingDirectory -p MainPID -p NRestarts
journalctl --namespace=fernblick -u fernblick.service --since '30 minutes ago' --no-pager
```

Use the actual configured listener for read-only checks:

```sh
curl --fail --silent --show-error http://CONFIRMED_HOST:8787/version.json
# Confirms dashboard connectivity/readiness; never sends an agent action:
curl --fail --silent --show-error --output /dev/null http://CONFIRMED_HOST:8787/api/agents
```

The dashboard can contain private agent details; do not copy its response body into service logs or support reports. A static version response proves HTTP/assets, not Herdr readiness. Watch for persistent 503s, start-limit hits, socket permissions, address availability and missing Node/browser dependencies. Do not print private EnvironmentFile contents when diagnosing.

### Logs and retention

Startup/crash/stdout/stderr go to the dedicated **`fernblick` journal namespace**. Its configuration uses persistent storage, a 100 MiB nominal cap, seven-day age limit, at most daily rotation, and a rate limit of 100 messages per 30 seconds. It leaves 1 GiB free when possible and limits volatile fallback to 16 MiB. Journal deletion is file-granular and may exceed nominal size/age limits for active files; capacity/rate limits can shorten or drop history. Persistent mode can fall back to volatile storage when disk is unwritable. Verify installed effective settings and retrieval after restart instead of promising guaranteed persistence.

```sh
systemd-analyze cat-config systemd/journald@fernblick.conf
journalctl --namespace=fernblick --disk-usage
journalctl --namespace=fernblick -u fernblick.service -o cat --since '1 hour ago' --no-pager
```

Fresh installation reads namespace retention settings when that journal instance starts. For later retention changes, restart **only** `systemd-journald@fernblick.service` during an approved maintenance window and verify stream logging; do not restart/vacuum the shared host journal or change unrelated services' retention. Old per-deployment files are preserved separately; this task does not delete them retroactively.

HER-20's saved read-receipt application files remain separate. Do not add a shell `tee` or a second file sink duplicating them. They and the phone's local history are documented by HER-20; operational startup/crash logs are the supervisor's responsibility.

### Updates, rollback and removal

- **Update:** approve/integrate/test the release first. During approved downtime, stop this service, preserve a known-good release, update the configured checkout, run `npm ci` and build with the pinned Node as the service user, then start/check it. No automatic pull, upgrade, environment changes or restart hooks. Never let multiple worktrees/servers use the same Pi socket or saved log directory.
- **Environment changes:** privately review/edit the environment file and restart only Fernblick during approved downtime. Regenerate/install the unit and daemon-reload if the Node path/checkout/user changes. Existing Pi processes keep their own environment; do not silently move their shared paths.
- **Rollback:** stop and disable the new service, verify its listener/cgroup are stopped, restore the preserved release/environment and use the recorded old launcher under the same owner. Start exactly one backend and re-check HTTP/Herdr/phone access. Keep sockets/data/history; do not blindly unlink the Pi bridge or change the proxy to make a failed cutover appear successful.
- **Remove:** stop/disable Fernblick, remove only its unit file, daemon-reload and reset-failed. Keep the private environment, application data and logs unless their owner separately approves deletion. Remove its journal namespace configuration only when retiring that namespace; do not delete host journals or other services' files. No agent/session cleanup is part of uninstall.

## Isolated verification

`npm run check` includes renderer/injection/preflight tests and, where systemd-analyze exists, offline verification of a generated unit. It **does not install/start a service**.

For an explicitly requested isolated runtime test on a systemd host, build this worktree and run as root:

```sh
npm run build
npm run service:smoke
```

The opt-in smoke test creates a uniquely named **transient** `fernblick-smoke-<uuid>.service` with private temporary HOME, sockets/data directories and an ephemeral loopback port. It starts the actual built backend, checks 503 with no Herdr, serves an empty synthetic Herdr snapshot and checks recovery, kills only that test unit's main process and verifies automatic restart, then checks that unit's startup journal. Finally it stops/collects only the test unit and removes its fixtures. It never installs/enables `fernblick.service`, contacts real Herdr/Pi sockets or changes production listeners. It tests supervision policies with a one-second restart delay and the default journal, not the uninstalled production namespace's retention settings. Live namespace/boot/cutover verification still needs deployment approval.

Official behavior references: [systemd.service](https://www.freedesktop.org/software/systemd/man/latest/systemd.service.html), [systemd.exec](https://www.freedesktop.org/software/systemd/man/latest/systemd.exec.html), [journal configuration](https://www.freedesktop.org/software/systemd/man/latest/journald.conf.html), [systemd-run](https://www.freedesktop.org/software/systemd/man/latest/systemd-run.html).
