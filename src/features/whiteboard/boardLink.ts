export interface WhiteboardLink {
  pane: string;
  session: string;
}

/** A viewing hint, never authorization. The live Pi session must also match. */
export function readWhiteboardLink(search: string): WhiteboardLink | null {
  const params = new URLSearchParams(search);
  const pane = params.get("pane");
  const session = params.get("session");
  if (
    params.get("whiteboard") !== "1" ||
    !pane ||
    !session ||
    pane.length > 200 ||
    session.length > 200 ||
    /[\r\n\0]/.test(pane + session)
  )
    return null;
  return { pane, session };
}

export function consumeWhiteboardLink() {
  const url = new URL(window.location.href);
  for (const key of ["pane", "session", "whiteboard"]) url.searchParams.delete(key);
  window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
}
