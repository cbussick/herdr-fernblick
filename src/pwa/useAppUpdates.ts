import { createContext, useContext } from "react";
import type { BuildInfo } from "./buildInfo";

export type CheckResult = "idle" | "up-to-date" | "update-ready" | "failed";
type AppUpdates = {
  online: boolean;
  available: boolean;
  noticeVisible: boolean;
  applying: boolean;
  checking: boolean;
  latest: BuildInfo | null;
  result: CheckResult;
  error: string;
  check: () => Promise<void>;
  apply: () => Promise<void>;
  dismiss: () => void;
};
export const AppUpdatesContext = createContext<AppUpdates | null>(null);
export function useAppUpdates() {
  return useContext(AppUpdatesContext);
}
