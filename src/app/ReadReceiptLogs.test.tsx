import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ReadReceiptLogs } from "./ReadReceiptLogs";
import { readReceiptRecordSchema } from "../shared/api/readReceiptDiagnostics";
import {
  clearReadReceiptHistory,
  getReadReceiptHistory,
} from "../shared/api/browserReadReceiptLog";

vi.mock("../shared/api/browserReadReceiptLog", () => ({
  getReadReceiptHistory: vi.fn(),
  clearReadReceiptHistory: vi.fn(),
  subscribeReadReceiptHistory: () => () => {},
}));
let renderer: ReactTestRenderer;
const writeText = vi.fn();
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("navigator", { onLine: false, clipboard: { writeText } });
  writeText.mockReset().mockResolvedValue(undefined);
  vi.mocked(getReadReceiptHistory).mockReturnValue({ available: true, records: [] });
  vi.mocked(clearReadReceiptHistory).mockReturnValue(true);
  await act(async () => {
    renderer = create(<ReadReceiptLogs />);
  });
});
afterEach(async () => {
  await act(async () => renderer.unmount());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function click(label: string) {
  const button = renderer.root
    .findAllByType("button")
    .find((node) => node.children.includes(label))!;
  await act(async () => {
    await button.props.onClick();
  });
}
it("views/copies saved logs offline and clears the displayed snapshot", async () => {
  const saved = readReceiptRecordSchema.parse({
    event: "read_receipt",
    schemaVersion: 1,
    build: "development",
    severity: "warn",
    boundary: "client",
    operation: "save",
    category: "network",
    durationMs: 1,
    timestamp: new Date().toISOString(),
    suppressed: 0,
    dropped: 0,
  });
  vi.mocked(getReadReceiptHistory).mockReturnValue({ available: true, records: [saved] });
  await click("View logs");
  expect(renderer.root.findByType("textarea").props.value).toBe(JSON.stringify(saved));
  await click("Copy logs");
  expect(writeText).toHaveBeenCalledWith(JSON.stringify(saved));
  await click("Clear logs");
  expect(clearReadReceiptHistory).toHaveBeenCalledOnce();
  expect(renderer.root.findByType("textarea").props.value).toBe("");
});
it("opens selectable plain text when clipboard access fails", async () => {
  writeText.mockRejectedValue(new Error("unavailable"));
  await click("Copy logs");
  const output = renderer.root.findByType("textarea");
  expect(output.props.readOnly).toBe(true);
  const select = vi.fn();
  output.props.onFocus({ currentTarget: { select } });
  expect(select).toHaveBeenCalledOnce();
  expect(renderer.root.findByProps({ role: "status" }).children.join("")).toContain(
    "Select the text",
  );
});
it("explains unavailable storage and failed clearing without pretending success", async () => {
  vi.mocked(getReadReceiptHistory).mockReturnValue({ available: false, records: [] });
  vi.mocked(clearReadReceiptHistory).mockReturnValue(false);
  await click("Copy logs");
  expect(writeText).not.toHaveBeenCalled();
  expect(renderer.root.findByProps({ role: "status" }).children.join("")).toContain("unavailable");
  await click("Clear logs");
  expect(renderer.root.findByProps({ role: "status" }).children.join("")).toContain(
    "Could not clear",
  );
});
