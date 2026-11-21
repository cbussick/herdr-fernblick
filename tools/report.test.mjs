import { afterEach, expect, it, vi } from "vitest";
import { report, reportError } from "./report.mjs";

const acceptWrite = () => true;
afterEach(() => vi.restoreAllMocks());
it("formats CLI results on stdout with a terminating newline", () => {
  const stdout = vi.spyOn(process.stdout, "write").mockImplementation(acceptWrite);
  const stderr = vi.spyOn(process.stderr, "write").mockImplementation(acceptWrite);
  report("Processed %d items", 3);
  expect(stdout).toHaveBeenCalledWith("Processed 3 items\n");
  expect(stderr).not.toHaveBeenCalled();
});
it("keeps diagnostics on stderr and formats object details", () => {
  const stdout = vi.spyOn(process.stdout, "write").mockImplementation(acceptWrite);
  const stderr = vi.spyOn(process.stderr, "write").mockImplementation(acceptWrite);
  reportError("Failed:", { reason: "fixture" });
  expect(stderr).toHaveBeenCalledWith("Failed: { reason: 'fixture' }\n");
  expect(stdout).not.toHaveBeenCalled();
});
