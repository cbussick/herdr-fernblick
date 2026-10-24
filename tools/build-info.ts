import { execFileSync } from "node:child_process";
import type { Plugin } from "vite";

// Generate once per Vite invocation: the embedded and network copies must match.
export function buildInfoPlugin(): Plugin {
  const revision = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const dirty = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim();
  const info = { revision: revision + (dirty ? "-dirty" : ""), builtAt: new Date().toISOString() };
  return {
    name: "fernblick-build-info",
    config: () => ({ define: { __FERNBLICK_BUILD__: JSON.stringify(info) } }),
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "version.json", source: JSON.stringify(info) });
    },
  };
}
