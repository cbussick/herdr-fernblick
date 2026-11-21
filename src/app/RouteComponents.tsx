import { useEffect } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { App } from "./App";
import { usePaneNavigation } from "./usePaneNavigation";
import { readWhiteboardLink } from "../features/whiteboard/boardLink";
import { Button } from "../shared/ui";
import { StateIcon } from "../shared/ui/StateFeedback";
import appStyles from "./App.module.css";

export function NotFoundPage() {
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

export function RouteShell() {
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

export function EmptyRoute() {
  return null;
}
