import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

const script = join(process.cwd(), "tools/systemd/render-service.mjs");
const args = [
  "--user",
  userInfo().username,
  "--group",
  "root",
  "--home",
  tmpdir(),
  "--workdir",
  process.cwd(),
  "--node",
  process.execPath,
  "--environment-path",
  "/etc/fernblick/fernblick.env",
];
it("renders an explicit system service without invoking a shell or service manager", () => {
  const rendered = execFileSync(process.execPath, [script, ...args], { encoding: "utf8" });
  expect(rendered).toContain(`WorkingDirectory=${process.cwd()}`);
  expect(rendered).toContain(
    `ExecStart=${process.execPath} ${process.cwd()}/dist-server/server/index.js`,
  );
  expect(rendered).toContain("Type=exec");
  expect(rendered).toContain("Restart=on-failure");
  expect(rendered).toContain("StartLimitBurst=5");
  expect(rendered).toContain("TimeoutStopSec=20s");
  expect(rendered).toContain("LogNamespace=fernblick");
  expect(rendered).toContain("WantedBy=multi-user.target");
  expect(rendered).toContain(
    `ExecStartPre=${process.execPath} ${process.cwd()}/tools/systemd/wait-host.mjs`,
  );
  expect(rendered).toContain("TimeoutStartSec=150s");
  expect(rendered).not.toMatch(/@[A-Z]+@|PrivateTmp|ProtectHome/);
});
it.each(["/tmp/a b", "/tmp/a\nExecStart=/bad", "/tmp/%h", "/tmp/$SECRET", "/tmp/../root"])(
  "rejects unsafe path syntax %j",
  (value) => {
    const unsafe = [...args];
    unsafe[unsafe.indexOf("--workdir") + 1] = value;
    const result = spawnSync(process.execPath, [script, ...unsafe], { encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).not.toContain(value);
  },
);
it("requires all fields and rejects unit-directive injection through identities", () => {
  expect(spawnSync(process.execPath, [script], { encoding: "utf8" }).status).toBe(1);
  const unsafe = [...args];
  unsafe[1] = "root\nExecStart=/bad";
  expect(spawnSync(process.execPath, [script, ...unsafe], { encoding: "utf8" }).status).toBe(1);
});

it("preflight allows loopback, waits briefly for an absent address and rejects wildcard listeners", () => {
  const preflight = join(process.cwd(), "tools/systemd/wait-host.mjs");
  for (const [host, expected] of [
    ["127.0.0.1", 0],
    ["198.51.100.77", 1],
    ["0.0.0.0", 1],
    ["::", 1],
    ["not-an-ip", 1],
  ] as const) {
    const result = spawnSync(process.execPath, [preflight, "--timeout-ms", "20"], {
      env: { PATH: process.env.PATH, HOST: host },
      encoding: "utf8",
      timeout: 5000,
    });
    expect(result.status).toBe(expected);
  }
});

const hasSystemd = spawnSync("systemd-analyze", ["--version"], { encoding: "utf8" }).status === 0;
it.skipIf(!hasSystemd)(
  "passes systemd's offline verifier and bounds only the dedicated journal namespace",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "fernblick-unit-"));
    try {
      const path = join(directory, "fernblick.service");
      await writeFile(path, execFileSync(process.execPath, [script, ...args]));
      const verified = spawnSync("systemd-analyze", ["verify", "--man=no", path], {
        encoding: "utf8",
      });
      expect(verified.stderr).not.toMatch(/Unknown|Invalid|Failed/);
      expect(verified.status).toBe(0);
      const retention = await readFile("deploy/systemd/journal-retention.conf", "utf8");
      expect(retention).toContain("journald@fernblick.conf.d");
      expect(retention).toContain("Storage=persistent");
      expect(retention).toContain("SystemMaxUse=100M");
      expect(retention).toContain("MaxRetentionSec=7day");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
