import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SettingsDialog } from "./SettingsDialog";
import { Snackbar } from "../shared/ui/Snackbar";
import { useAppUpdates } from "../pwa/useAppUpdates";

vi.mock("../pwa/useAppUpdates", () => ({ useAppUpdates: vi.fn() }));
const check = vi.fn();
const writeText = vi.fn();
let renderer: ReactTestRenderer;
const dialog = {
  open: false,
  ownerDocument: { activeElement: null },
  showModal: vi.fn(),
  close: vi.fn(),
};

beforeEach(async () => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("HTMLElement", class {});
  vi.stubGlobal("navigator", {
    onLine: true,
    clipboard: { writeText },
    userAgent: "Fixture browser",
  });
  vi.stubGlobal("window", {
    matchMedia: () => ({ matches: false }),
    innerWidth: 390,
    innerHeight: 844,
    devicePixelRatio: 1,
    isSecureContext: true,
  });
  dialog.open = false;
  dialog.showModal.mockImplementation(() => {
    dialog.open = true;
  });
  dialog.close.mockImplementation(() => {
    dialog.open = false;
  });
  check.mockResolvedValue("up-to-date");
  writeText.mockResolvedValue(undefined);
  vi.mocked(useAppUpdates).mockReturnValue({
    online: true,
    available: false,
    noticeVisible: false,
    applying: false,
    checking: false,
    latest: null,
    result: "up-to-date",
    error: "",
    check,
    apply: vi.fn(),
    dismiss: vi.fn(),
  });
  await act(async () => {
    renderer = create(<SettingsDialog onClose={vi.fn()} />, {
      createNodeMock: (node) => (node.type === "dialog" ? dialog : null),
    });
  });
});
afterEach(async () => {
  await act(async () => renderer.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const snackbars = () => renderer.root.findAllByType(Snackbar);
const click = (label: string) =>
  act(async () => {
    await renderer.root
      .findAllByType("button")
      .find((node) => node.children.includes(label))!
      .props.onClick();
  });
const advance = (ms: number) =>
  act(async () => {
    vi.advanceTimersByTime(ms);
  });

it("does not replay a previously completed check when settings opens", () => {
  expect(snackbars()).toHaveLength(0);
  expect(check).not.toHaveBeenCalled();
});

it("shows Up to date only in a dialog-layer snackbar after a manual check", async () => {
  await click("Check for updates");
  expect(check).toHaveBeenCalledOnce();
  expect(snackbars()[0].props).toMatchObject({
    message: "Up to date.",
    placement: "dialog",
    role: "status",
  });
  const about = renderer.root.findByProps({ "aria-labelledby": "about-updates-heading" });
  expect(about.findAllByType("p").every((node) => !node.children.includes("Up to date."))).toBe(
    true,
  );
  await advance(6_000);
  expect(snackbars()).toHaveLength(0);
});

it("starts a fresh snackbar interval for repeated checks with the same result", async () => {
  await click("Check for updates");
  await advance(5_000);
  await click("Check for updates");
  await advance(5_999);
  expect(snackbars()).toHaveLength(1);
  await advance(1);
  expect(snackbars()).toHaveLength(0);
});

it("confirms diagnostic copies without inserting text into the diagnostics section", async () => {
  await click("Copy diagnostics");
  expect(writeText).toHaveBeenCalledOnce();
  expect(JSON.parse(writeText.mock.calls[0][0])).toMatchObject({
    headerLayout: { version: 1 },
  });
  expect(snackbars()[0].props.message).toBe("Diagnostics copied.");
  const section = renderer.root.findByProps({ "aria-labelledby": "diagnostics-heading" });
  expect(section.findAllByType("p")).toHaveLength(0);
  await act(async () =>
    renderer.root.findByProps({ "aria-label": "Dismiss notification" }).props.onClick(),
  );
  expect(snackbars()).toHaveLength(0);
});

it("keeps copy failures visible until dismissed and permits viewing diagnostics", async () => {
  writeText.mockRejectedValue(new Error("Clipboard blocked"));
  await click("Copy diagnostics");
  expect(snackbars()[0].props).toMatchObject({ role: "alert", duration: null });
  await advance(60_000);
  expect(snackbars()).toHaveLength(1);
  await act(async () =>
    renderer.root.findByProps({ "aria-label": "View diagnostics" }).props.onClick(),
  );
  expect(snackbars()).toHaveLength(0);
  expect(renderer.root.findByType("pre").props.hidden).toBe(false);
});

it("does not announce success when an update check fails or is skipped", async () => {
  check.mockResolvedValueOnce("failed").mockResolvedValueOnce(undefined);
  await click("Check for updates");
  await click("Check for updates");
  expect(snackbars()).toHaveLength(0);
});
