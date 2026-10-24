import { z } from "zod";

const buildSchema = z.object({
  revision: z.string().regex(/^[a-f0-9]{40}(?:-dirty)?$/),
  builtAt: z.string().datetime(),
});
export type BuildInfo = { revision: string; builtAt: string | null };
declare const __FERNBLICK_BUILD__: BuildInfo;

// Storybook and non-Vite test consumers have no production build injected.
export const runningBuild: BuildInfo =
  typeof __FERNBLICK_BUILD__ === "undefined"
    ? { revision: "development", builtAt: null }
    : __FERNBLICK_BUILD__;

export async function fetchLatestBuild(): Promise<BuildInfo> {
  const response = await fetch("/version.json", {
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok)
    throw new Error("Could not reach the latest build. Check your tailnet connection.");
  const parsed = buildSchema.safeParse(await response.json());
  if (!parsed.success) throw new Error("The server did not return valid build information.");
  return parsed.data;
}

export function sameBuild(a: BuildInfo, b: BuildInfo) {
  return a.revision === b.revision && a.builtAt === b.builtAt;
}
