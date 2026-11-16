import {
  createBrowserHistory,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  type RouterHistory,
} from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { RouterProvider, useRouterState } from "@tanstack/react-router";
import { App } from "./App";
import { usePaneNavigation } from "./usePaneNavigation";
import { readWhiteboardLink } from "../features/whiteboard/boardLink";

function RouteShell() {
  const navigation = usePaneNavigation();
  useEffect(() => {
    const link = readWhiteboardLink(navigation.location.searchStr);
    if (link) navigation.selectSession(link.session, "whiteboard", true);
  }, [navigation]);
  const notFound = useRouterState({
    select: (state) =>
      state.matches.some((match) => match._notFound || match.status === "notFound"),
  });
  return notFound ? (
    <main id="main-content">
      <h1>Page not found</h1>
      <a href="/">Back to overview</a>
    </main>
  ) : (
    <App navigation={navigation} />
  );
}

export function RoutedApp({ history }: { history?: RouterHistory } = {}) {
  const [router] = useState(() => createAppRouter(history));
  return <RouterProvider router={router} />;
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
declare module "@tanstack/history" {
  interface HistoryState {
    fernblickOverviewIndex?: number;
    fernblickChatIndex?: number;
  }
}

// The shell owns the live connection and composer across sibling view changes.
export function createAppRouter(history?: RouterHistory) {
  const root = createRootRoute({ component: RouteShell });
  const empty = () => null;
  const routes = [
    createRoute({ getParentRoute: () => root, path: "/", component: empty }),
    ...(["chat", "terminal", "whiteboard"] as const).map((view) =>
      createRoute({
        getParentRoute: () => root,
        path: `/sessions/$sessionId/${view}`,
        component: empty,
      }),
    ),
    ...(["chat", "terminal"] as const).map((view) =>
      createRoute({ getParentRoute: () => root, path: `/panes/$paneId/${view}`, component: empty }),
    ),
  ];
  return createRouter({
    routeTree: root.addChildren(routes),
    history:
      history ??
      (typeof window === "undefined"
        ? createMemoryHistory({ initialEntries: ["/"] })
        : createBrowserHistory()),
    defaultNotFoundComponent: () => (
      <main id="main-content">
        <h1>Page not found</h1>
        <a href="/">Back to overview</a>
      </main>
    ),
  });
}
