/// <reference lib="webworker" />
import { createHandlerBoundToURL, precacheAndRoute } from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
};

precacheAndRoute(self.__WB_MANIFEST);
// Serve the shell for known client routes only, never API/image requests.
registerRoute(
  new NavigationRoute(createHandlerBoundToURL("/index.html"), {
    allowlist: [
      /^\/(?:\?.*)?$/,
      /^\/index\.html(?:\?.*)?$/,
      /^\/sessions\/[^/]+\/(?:chat|terminal|whiteboard)\/?(?:\?.*)?$/,
      /^\/panes\/[^/]+\/(?:chat|terminal)\/?(?:\?.*)?$/,
    ],
  }),
);

// No runtime data caches, background sync, automatic activation or clientsClaim.
self.addEventListener("message", (event) => {
  const data: unknown = event.data;
  if (typeof data === "object" && data !== null && "type" in data && data.type === "SKIP_WAITING") {
    void self.skipWaiting();
  }
});
