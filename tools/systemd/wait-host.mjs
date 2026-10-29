import { isIP } from "node:net";
import { networkInterfaces } from "node:os";
import { setTimeout } from "node:timers/promises";
import { parseArgs } from "node:util";

// Boot may reach network-online before Tailscale has assigned its address.
// Never creates/changes an interface, starts Herdr or reads agent data.
try {
  const { values } = parseArgs({
    options: { "timeout-ms": { type: "string", default: "120000" } },
    strict: true,
  });
  const timeout = Number(values["timeout-ms"]);
  const host = process.env.HOST ?? "127.0.0.1";
  if (
    !Number.isInteger(timeout) ||
    timeout < 0 ||
    timeout > 120_000 ||
    !isIP(host) ||
    host === "0.0.0.0" ||
    host === "::"
  )
    throw new Error("configuration");
  const deadline = Date.now() + timeout;
  while (
    !Object.values(networkInterfaces())
      .flat()
      .some((entry) => entry?.address === host)
  ) {
    if (Date.now() >= deadline) throw new Error("address unavailable");
    await setTimeout(Math.min(500, Math.max(1, deadline - Date.now())));
  }
} catch {
  process.stderr.write(
    "Fernblick preflight: configure a specific local loopback/Tailnet IP in HOST; it must be available before startup. No network or Herdr settings changed.\n",
  );
  process.exitCode = 1;
}
