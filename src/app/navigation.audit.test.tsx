// @vitest-environment happy-dom
// Passing navigation-history regressions from docs/session-navigation-audit.md.
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { afterEach, expect, it, vi } from "vitest";
import { createAppRouter } from "./router";
import type { usePaneNavigation } from "./usePaneNavigation";

vi.mock("./App", () => ({
  App: ({ navigation: n }: { navigation: ReturnType<typeof usePaneNavigation> }) => (
    <main data-session={n.sessionId} data-view={n.view}>
      <button onClick={() => n.selectSession("a", "chat")}>Open A</button>
      <button onClick={() => n.selectSession("b", "chat", true)}>Switch B</button>
      <button onClick={() => n.selectSession(n.sessionId!, "terminal")}>Terminal</button>
      <button onClick={() => n.selectSession(n.sessionId!, "whiteboard")}>Board</button>
      <button onClick={() => n.selectSession(n.sessionId!, "chat")}>Close board</button>
      <button onClick={() => n.selectSession("b", "whiteboard", true)}>Promote B board</button>
      <button onClick={() => n.selectPane(null)}>Overview</button>
    </main>
  ),
}));
let renderer: ReactTestRenderer;
let router: ReturnType<typeof createAppRouter>;
async function start(path = "/") {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  router = createAppRouter(createMemoryHistory({ initialEntries: [path] }));
  await router.load();
  await act(async () => {
    renderer = create(<RouterProvider router={router} />);
  });
}
async function click(label: string) {
  await act(async () => {
    renderer.root
      .findAllByType("button")
      .find((b) => b.children.includes(label))!
      .props.onClick();
  });
}
afterEach(async () => {
  await act(async () => renderer?.unmount());
  vi.unstubAllGlobals();
});

it("audit: closing a promoted fresh board returns to that session's chat", async () => {
  await start();
  await click("Open A");
  await click("Promote B board");
  expect(router.state.location.pathname).toBe("/sessions/b/whiteboard");
  await click("Close board");
  expect(router.state.location.pathname).toBe("/sessions/b/chat");
});

// Helper-level invariant; the current terminal UI does not expose a Board button.
it("audit: terminal-to-board after switching sessions cannot return to a different conversation", async () => {
  await start();
  await click("Open A");
  await click("Board");
  await click("Switch B");
  await click("Terminal");
  await click("Board");
  await click("Close board");
  expect(router.state.location.pathname).toBe("/sessions/b/chat");
});

it("audit: closing a direct-link board does not make Back reopen it", async () => {
  await start("/sessions/a/whiteboard");
  await click("Close board");
  expect(router.state.location.pathname).toBe("/sessions/a/chat");
  await act(async () => router.history.back());
  expect(router.state.location.pathname).not.toBe("/sessions/a/whiteboard");
});

it.each([-1, 0, 10, Number.NaN])(
  "replaces a board with chat for invalid or non-older return index %s",
  async (index) => {
    await start("/sessions/a/whiteboard");
    await act(async () =>
      router.history.replace(router.state.location.href, {
        ...router.state.location.state,
        fernblickChatReturn: { kind: "session", id: "a", index },
      }),
    );
    const go = vi.spyOn(router.history, "go");
    await click("Close board");
    expect(go).not.toHaveBeenCalled();
    expect(router.state.location.pathname).toBe("/sessions/a/chat");
  },
);

it("audit: overview remains reachable through repeated terminal/chat/board cycles", async () => {
  await start();
  await click("Open A");
  await click("Terminal");
  await click("Close board");
  await click("Board");
  await click("Close board");
  await click("Overview");
  expect(router.state.location.pathname).toBe("/");
});
