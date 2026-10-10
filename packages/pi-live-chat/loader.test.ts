import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { expect, it } from "vitest";

const exec = promisify(execFile);
it("installs a local package into an isolated Pi directory and loads .js-to-.ts imports with pinned Pi jiti", async () => {
  // No user settings, user agents, models, or real session_start are touched.
  const root = resolve("node_modules/.tmp");
  await mkdir(root, { recursive: true });
  const dir = await mkdtemp(join(root, "pi-loader-"));
  const packagePath = resolve("packages/pi-live-chat");
  const piRoot = resolve("node_modules/@earendil-works/pi-coding-agent/dist");
  const env = { ...process.env, PI_CODING_AGENT_DIR: join(dir, "agent"), PI_OFFLINE: "1" };
  try {
    await exec(process.execPath, [join(piRoot, "cli.js"), "install", packagePath], {
      cwd: dir,
      env,
      timeout: 30_000,
    });
    const settings = JSON.parse(await readFile(join(dir, "agent/settings.json"), "utf8"));
    expect(settings.packages.map((source: string) => resolve(dir, "agent", source))).toContain(
      packagePath,
    );
    // Use the actual published loader, not a replacement factory loader or tsx.
    const loaderUrl = pathToFileURL(join(piRoot, "core/extensions/loader.js")).href;
    const result = await exec(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
      const { loadExtensions } = await import(${JSON.stringify(loaderUrl)});
      const result = await loadExtensions([${JSON.stringify(join(packagePath, "index.ts"))}], ${JSON.stringify(dir)});
      console.log(JSON.stringify({ errors: result.errors, events: [...result.extensions[0]?.handlers.keys() ?? []] }));
    `,
      ],
      { cwd: dir, env, timeout: 30_000 },
    );
    const loaded = JSON.parse(result.stdout.trim());
    expect(loaded.errors).toEqual([]);
    expect(loaded.events).toContain("session_start");
    expect(loaded.events).toContain("agent_settled");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 40_000);
