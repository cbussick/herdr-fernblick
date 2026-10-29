import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, mkdir, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";

// Explicit, opt-in host test. Creates ONLY a random transient test service, never fernblick.service.
if (process.argv[2] !== "--isolated" || process.getuid?.() !== 0) {
  throw new Error(
    "Requires --isolated as root on a systemd host. Never installs/enables the production service.",
  );
}
const run = promisify(execFile);
const project = resolve(process.cwd());
await access(join(project, "dist-server/server/index.js"));
const root = await mkdtemp(join(tmpdir(), "fb-service-"));
const unit = `fernblick-smoke-${randomUUID()}.service`;
const home = join(root, "home");
const socket = join(root, "herdr.sock");
const probe = createServer();
await new Promise((done) => probe.listen(0, "127.0.0.1", done));
const port = probe.address().port;
await new Promise((done) => probe.close(done));
let herdr;
try {
  await mkdir(home, { mode: 0o700 });
  const environment = {
    HOME: home,
    PATH: `${dirname(process.execPath)}:/usr/local/bin:/usr/bin:/bin`,
    NODE_ENV: "production",
    HOST: "127.0.0.1",
    PORT: String(port),
    HERDR_SOCKET_PATH: socket,
    FERNBLICK_PI_SOCKET: join(root, "pi/bridge.sock"),
    FERNBLICK_PI_SESSION_DIR: join(root, "sessions"),
    FERNBLICK_BOARD_DIR: join(root, "boards"),
    FERNBLICK_READ_RECEIPT_DIR: join(root, "receipts"),
    FERNBLICK_UPLOAD_DIR: join(root, "uploads"),
    FERNBLICK_LOG_DIR: join(root, "logs"),
  };
  await run(
    "systemd-run",
    [
      "--quiet",
      "--collect",
      `--unit=${unit}`,
      "--service-type=exec",
      `--working-directory=${project}`,
      "--property=Restart=on-failure",
      "--property=RestartSec=1s",
      "--property=StartLimitIntervalSec=120",
      "--property=StartLimitBurst=5",
      "--property=TimeoutStopSec=20s",
      "--property=KillMode=control-group",
      "--property=UMask=0077",
      "--property=StandardOutput=journal",
      "--property=StandardError=journal",
      ...Object.entries(environment).map(([key, value]) => `--setenv=${key}=${value}`),
      process.execPath,
      join(project, "dist-server/server/index.js"),
    ],
    { timeout: 15_000 },
  );
  const url = `http://127.0.0.1:${port}/api/agents`;
  async function waitFor(check) {
    const deadline = Date.now() + 25_000;
    while (Date.now() < deadline) {
      if (await check().catch(() => false)) return;
      await new Promise((done) => setTimeout(done, 200));
    }
    throw new Error("Isolated service did not reach expected state; inspect only " + unit);
  }
  await waitFor(
    async () => (await fetch(url, { signal: AbortSignal.timeout(1000) })).status === 503,
  );
  // Only this synthetic socket is ever served; no real agent/session exists in the fixture.
  herdr = createServer((peer) => {
    peer.setEncoding("utf8");
    let buffer = "";
    peer.on("data", (chunk) => {
      buffer += chunk;
      if (!buffer.includes("\n")) return;
      const request = JSON.parse(buffer.split("\n")[0]);
      if (request.method !== "session.snapshot") {
        peer.destroy();
        return;
      }
      peer.end(
        JSON.stringify({
          id: request.id,
          result: {
            type: "session_snapshot",
            snapshot: { agents: [], panes: [], tabs: [], workspaces: [] },
          },
        }) + "\n",
      );
    });
    peer.on("error", () => {});
  });
  await new Promise((done) => herdr.listen(socket, done));
  await waitFor(
    async () => (await fetch(url, { signal: AbortSignal.timeout(1000) })).status === 200,
  );
  const before = (
    await run("systemctl", ["show", unit, "--property=NRestarts", "--value"])
  ).stdout.trim();
  await run("systemctl", ["kill", "--kill-whom=main", "--signal=SIGKILL", unit]);
  await waitFor(async () => {
    const count = Number(
      (await run("systemctl", ["show", unit, "--property=NRestarts", "--value"])).stdout.trim(),
    );
    return (
      count > Number(before) &&
      (await fetch(url, { signal: AbortSignal.timeout(1000) })).status === 200
    );
  });
  const journal = (await run("journalctl", ["-u", unit, "--no-pager", "-o", "cat"])).stdout;
  if (!journal.includes("Fernblick listening"))
    throw new Error("Isolated startup log was not retrievable");
  console.log(
    "PASS: isolated backend starts; absent Herdr returns 503; fixture recovery returns 200; crash restarts; startup journal is retrievable. No production service changed.",
  );
} finally {
  const stopped = await run("systemctl", ["stop", unit])
    .then(() => true)
    .catch(async () => {
      const state = await run("systemctl", ["show", unit, "--property=LoadState", "--value"]).catch(
        () => null,
      );
      return state?.stdout.trim() === "not-found";
    });
  if (!stopped) {
    console.error(`Could not stop isolated unit ${unit}; retained fixture ${root} for recovery.`);
    process.exitCode = 1;
  } else {
    await run("systemctl", ["reset-failed", unit]).catch(() => {});
  }
  if (herdr) await new Promise((done) => herdr.close(done));
  if (stopped) await rm(root, { recursive: true, force: true });
}
