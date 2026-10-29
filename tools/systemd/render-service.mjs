import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { parseArgs } from "node:util";

// Render only. Never install, enable, stop or start any service.
try {
  const { values } = parseArgs({
    options: Object.fromEntries(
      ["user", "group", "home", "workdir", "node", "environment-path"].map((key) => [
        key,
        { type: "string" },
      ]),
    ),
    strict: true,
    allowPositionals: false,
  });
  for (const key of ["user", "group"]) {
    if (!/^[a-z_][a-z0-9_-]{0,31}$/i.test(values[key] ?? "")) throw new Error("identity");
  }
  for (const key of ["home", "workdir", "node", "environment-path"]) {
    const value = values[key];
    // Deliberately reject whitespace, quotes, $, %, backslashes and control characters.
    // This tool supports the host's simple absolute paths, not arbitrary unit syntax.
    if (
      !value ||
      !isAbsolute(value) ||
      resolve(value) !== value ||
      !/^\/[a-z0-9_./-]+$/i.test(value)
    )
      throw new Error("path");
  }
  const template = await readFile(
    new URL("../../deploy/systemd/fernblick.service.in", import.meta.url),
    "utf8",
  );
  const replacements = {
    USER: values.user,
    GROUP: values.group,
    HOME: values.home,
    WORKDIR: values.workdir,
    NODE: values.node,
    NODEDIR: dirname(values.node),
    ENVFILE: values["environment-path"],
  };
  const rendered = template.replace(/@([A-Z]+)@/g, (_match, key) => replacements[key]);
  if (/@[A-Z]+@/.test(rendered)) throw new Error("template");
  process.stdout.write(rendered);
} catch {
  process.stderr.write(
    "Cannot render service. Supply --user --group --home --workdir --node --environment-path. Use explicit Unix names and normalized absolute paths containing only letters, digits, _, ., / and -. No service was changed.\n",
  );
  process.exitCode = 1;
}
