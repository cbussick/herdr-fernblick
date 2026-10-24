import { afterEach, expect, it, vi } from "vitest";
import { consumeWhiteboardLink, readWhiteboardLink } from "./boardLink";

afterEach(() => vi.unstubAllGlobals());
it("parses only complete conversation-bound board links", () => {
  expect(readWhiteboardLink("?pane=w1%3Ap2&session=session-a&whiteboard=1")).toEqual({
    pane: "w1:p2",
    session: "session-a",
  });
  for (const value of [
    "",
    "?pane=w1:p2",
    "?pane=w1:p2&whiteboard=1",
    "?session=a&whiteboard=1",
    "?pane=w1:p2&session=a&whiteboard=0",
    "?pane=w1%0Ap2&session=a&whiteboard=1",
    `?pane=${"x".repeat(201)}&session=a&whiteboard=1`,
  ])
    expect(readWhiteboardLink(value)).toBeNull();
});
it("consumes a viewing hint without discarding unrelated URL or history state", () => {
  const state = { fernblickPaneId: "w1:p2", other: true };
  const replaceState = vi.fn();
  vi.stubGlobal("window", {
    location: {
      href: "https://fernblick.example/?pane=w1:p2&session=a&whiteboard=1&theme=light#anchor",
    },
    history: { state, replaceState },
  });
  consumeWhiteboardLink();
  expect(replaceState).toHaveBeenCalledWith(state, "", "/?theme=light#anchor");
});
