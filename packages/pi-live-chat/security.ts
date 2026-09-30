import { lstat, mkdir, readFile, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";

export function socketPath() {
  return process.env.FERNBLICK_PI_SOCKET ?? join(homedir(), ".local/share/fernblick/live/pi.sock");
}
export async function privateDirectory(path: string, create = false) {
  if (!isAbsolute(path) || Buffer.byteLength(path) > 100)
    throw new Error("Use an absolute Unix socket path of at most 100 bytes");
  const dir = dirname(path);
  if (create) {
    // Do not follow an ancestor symlink even while creating missing directories.
    let current: string = sep;
    for (const part of resolve(dir).split(sep).filter(Boolean)) {
      current = join(current, part);
      let info;
      try {
        info = await lstat(current);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        try {
          await mkdir(current, { mode: 0o700 });
        } catch (mkdirError) {
          if ((mkdirError as NodeJS.ErrnoException).code !== "EEXIST") throw mkdirError;
        }
        info = await lstat(current);
      }
      if (!info.isDirectory())
        throw new Error("Pi socket directory ancestors must be directories without symlinks");
    }
  }
  const info = await lstat(dir);
  if (
    !info.isDirectory() ||
    info.uid !== process.getuid?.() ||
    (info.mode & 0o777) !== 0o700 ||
    (await realpath(dir)) !== resolve(dir)
  )
    throw new Error("Pi socket directory must be owned by this user, mode 0700, without symlinks");
}
export async function validateSocket(path: string) {
  await privateDirectory(path);
  const info = await lstat(path);
  if (!info.isSocket() || info.uid !== process.getuid?.() || (info.mode & 0o777) !== 0o600)
    throw new Error("Pi socket must be owned by this user and mode 0600");
  return info;
}
export function parseProcessStat(source: string) {
  const fields = source
    .slice(source.lastIndexOf(")") + 2)
    .trim()
    .split(/\s+/);
  return {
    start: fields[19],
    foreground: fields[4] !== "0" && fields[2] === fields[5] && Number(fields[5]) > 0,
    alive: fields[0] !== "Z",
  };
}
export async function processIdentity(pid: number) {
  const root = "/proc/" + pid;
  const [info, source, env] = await Promise.all([
    stat(root),
    readFile(root + "/stat", "utf8"),
    readFile(root + "/environ", "utf8"),
  ]);
  if (info.uid !== process.getuid?.()) throw new Error("Pi process belongs to another user");
  const values = new Map(
    env.split("\0").map((part) => {
      const i = part.indexOf("=");
      return [part.slice(0, i), part.slice(i + 1)];
    }),
  );
  return {
    ...parseProcessStat(source),
    pane: values.get("HERDR_PANE_ID"),
    herdrSocket: values.get("HERDR_SOCKET_PATH"),
  };
}
