// @vitest-environment happy-dom
import { act } from "react";
import { create } from "react-test-renderer";
import type { ReactTestRenderer } from "react-test-renderer";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { afterEach, expect, it, vi } from "vitest";
import { createAppRouter } from "./router";
import type { usePaneNavigation } from "./usePaneNavigation";
import { Button } from "../shared/ui";
import { StateIcon } from "../shared/ui/StateFeedback";

vi.mock("./App", () => ({
  App: ({ navigation: n }: { navigation: ReturnType<typeof usePaneNavigation> }) => (
    <main data-pane={n.paneId} data-session={n.sessionId} data-view={n.view}>
      <button type="button" onClick={() => n.selectPane("w1:p1")}>
        First
      </button>
      <button type="button" onClick={() => n.selectPane("w1:p2")}>
        Second
      </button>
      <button type="button" onClick={() => n.selectSession("s", "chat", true)}>
        Canonical
      </button>
      <button type="button" onClick={() => n.selectSession("s", "whiteboard")}>
        Board
      </button>
      <button type="button" onClick={() => n.selectSession("s", "chat")}>
        Chat
      </button>
      <button type="button" onClick={() => n.selectPane(null)}>
        Overview
      </button>
    </main>
  ),
}));
let renderer: ReactTestRenderer;
let router: ReturnType<typeof createAppRouter>;
afterEach(async () => {
  await act(async () => renderer?.unmount());
  vi.unstubAllGlobals();
});
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
async function go(delta: number) {
  await act(async () => {
    router.history.go(delta);
  });
}

it("opens panes, replaces switches, and restores detail on Forward", async () => {
  await start();
  await click("First");
  expect(router.state.location.pathname).toBe("/panes/w1%3Ap1/chat");
  await click("Second");
  await go(-1);
  expect(router.state.location.pathname).toBe("/");
  await go(1);
  expect(renderer.root.findByType("main").props["data-pane"]).toBe("w1:p2");
});
it("canonicalizes a live pane without adding a history entry", async () => {
  await start();
  await click("First");
  await click("Canonical");
  expect(router.state.location.pathname).toBe("/sessions/s/chat");
  await click("Overview");
  expect(router.state.location.pathname).toBe("/");
  await go(1);
  expect(router.state.location.pathname).toBe("/sessions/s/chat");
});
it("Back closes a whiteboard and preserves the session", async () => {
  await start("/sessions/s/chat");
  await click("Board");
  expect(router.state.location.pathname).toBe("/sessions/s/whiteboard");
  await go(-1);
  expect(renderer.root.findByType("main").props["data-view"]).toBe("chat");
  expect(renderer.root.findByType("main").props["data-session"]).toBe("s");
});
it("closing a board returns to the existing chat entry", async () => {
  await start("/sessions/s/chat");
  await click("Board");
  await click("Chat");
  expect(router.state.location.pathname).toBe("/sessions/s/chat");
  await go(1);
  expect(router.state.location.pathname).toBe("/sessions/s/whiteboard");
});
it("recognizes views on links with a trailing slash", async () => {
  await start("/sessions/s/whiteboard/");
  expect(renderer.root.findByType("main").props["data-view"]).toBe("whiteboard");
  expect(renderer.root.findByType("main").props["data-session"]).toBe("s");
});

it("direct links have an explicit local overview destination", async () => {
  await start("/sessions/s/whiteboard");
  await click("Overview");
  expect(router.state.location.pathname).toBe("/");
});
it("converts legacy terminal whiteboard links to session URLs", async () => {
  await start("/?pane=w1%3Ap1&session=s&whiteboard=1");
  expect(router.state.location.pathname).toBe("/sessions/s/whiteboard");
  expect(router.state.location.searchStr).toBe("");
});
it.each(["/unknown", "/sessions/s/unknown", "/panes/w1%3Ap1/unknown"])(
  "shows a styled not-found page with overview navigation for %s",
  async (path) => {
    await start(path);
    expect(renderer.root.findByType("h1").children).toEqual(["Page not found"]);
    expect(renderer.root.findByType(StateIcon).props.kind).toBe("unavailable");
    expect(renderer.root.findByType(Button).props.children).toBe("Back to overview");
    expect(renderer.root.findByType("main").props.className).toBeTruthy();
    await click("Back to overview");
    expect(router.state.location.pathname).toBe("/");
    expect(renderer.root.findAllByType("h1")).toHaveLength(0);
  },
);
