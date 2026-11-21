import {
  createBrowserHistory,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import type { RouterHistory } from "@tanstack/react-router";
import { EmptyRoute, NotFoundPage, RouteShell } from "./RouteComponents";

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
  const routes = [
    createRoute({ getParentRoute: () => root, path: "/", component: EmptyRoute }),
    ...(["chat", "terminal", "whiteboard"] as const).map((view) =>
      createRoute({
        getParentRoute: () => root,
        path: `/sessions/$sessionId/${view}`,
        component: EmptyRoute,
      }),
    ),
    ...(["chat", "terminal"] as const).map((view) =>
      createRoute({
        getParentRoute: () => root,
        path: `/panes/$paneId/${view}`,
        component: EmptyRoute,
      }),
    ),
  ];
  return createRouter({
    routeTree: root.addChildren(routes),
    history:
      history ??
      (typeof window === "undefined"
        ? createMemoryHistory({ initialEntries: ["/"] })
        : createBrowserHistory()),
    defaultNotFoundComponent: NotFoundPage,
  });
}
