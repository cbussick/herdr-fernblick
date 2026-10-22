import { expect, it } from "vitest";
import { localImageSource } from "./localImages";

it.each([
  "preview.png",
  "./preview.png",
  "../design/preview.png",
  ".worktrees/message-timestamps/.runtime/message-timestamps.png",
  "assets/Logo%20%231%20%3F%20%2520%20%C3%BC.png",
])("resolves relative image %j against the session cwd, decoding exactly once", (destination) => {
  const path = `/workspace/project/${decodeURIComponent(destination)}`;
  expect(localImageSource(destination, "/workspace/project")).toBe(
    `/api/local-images?path=${encodeURIComponent(path)}`,
  );
});

it.each(["/", "/workspace/project/"])(
  "accepts cwd %j without introducing leading double slashes",
  (cwd) => {
    const path = `${cwd}preview.png`;
    expect(localImageSource("preview.png", cwd)).toBe(
      `/api/local-images?path=${encodeURIComponent(path)}`,
    );
  },
);

it.each([undefined, "", "relative", "~/project", "//host/project", "/project\u0000"])(
  "does not guess a directory for relative images when cwd is %j",
  (cwd) => expect(localImageSource("preview.png", cwd)).toBeUndefined(),
);

it.each([
  "",
  "https://example.com/a.png",
  "file:///tmp/a.png",
  "javascript:alert(1)",
  "data:image/png;base64,AA",
  "javascript%3Aalert(1)",
  "//host/a.png",
  "%2F%2Fhost/a.png",
  "%2Ftmp/a.png",
  "\\\\host\\a.png",
  "C:\\a.png",
  "~/a.png",
  "#preview",
  "?path=a.png",
  "bad%00.png",
  "bad\u0001.png",
])("does not turn unsupported destination %j into a local image", (destination) => {
  expect(localImageSource(destination, "/workspace/project")).toBeUndefined();
});

it("keeps absolute paths independent of the session cwd", () => {
  expect(localImageSource("/tmp/logo%20%2520.png", "/elsewhere")).toBe(
    "/api/local-images?path=%2Ftmp%2Flogo%20%2520.png",
  );
});

it("rejects resolved paths exceeding the filesystem path limit", () => {
  expect(localImageSource("a".repeat(4096), "/project")).toBeUndefined();
});
