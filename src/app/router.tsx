import {
  createBrowserHistory,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import type { RouterHistory } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { RouterProvider, useNavigate, useRouterState } from "@tanstack/react-router";
import { App } from "./App";
import { usePaneNavigation } from "./usePaneNavigation";
import { readWhiteboardLink } from "../features/whiteboard/boardLink";
import { Button } from "../shared/ui";
import { StateIcon } from "../shared/ui/StateFeedback";
import appStyles from "./App.module.css";

function NotFoundPage() {
  const navigate = useNavigate();
  return (
    <main id="main-content" className={`${appStyles["app-shell"]} ${appStyles["console-empty"]}`}>
      <section className={appStyles["conversation-state"]} aria-labelledby="not-found-title">
        <StateIcon kind="unavailable" />
        <h1 id="not-found-title">Page not found</h1>
        <p>This page may have moved, or the address is incorrect.</p>
        <div className={appStyles["conversation-state__actions"]}>
          <Button type="button" onClick={() => void navigate({ to: "/" })}>
            Back to overview
          </Button>
        </div>
      </section>
    </main>
  );
}

function RouteShell() {
  const navigation = usePaneNavigation();
  useEffect(() => {
    const link = readWhiteboardLink(navigation.location.searchStr);
    if (link) {
      navigation.selectSession(link.session, "whiteboard", true);
    }
  }, [navigation]);
  const notFound = useRouterState({
    select: (state) =>
      state.matches.some((match) => match._notFound || match.status === "notFound"),
  });
  return notFound ? <NotFoundPage /> : <App navigation={navigation} />;
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

function EmptyRoute() {
  return null;
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
