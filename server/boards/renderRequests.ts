import type { APIResponse, Request } from "playwright";

type RenderRequest = Pick<Request, "url" | "method" | "resourceType" | "isNavigationRequest">;
type RenderResponse = Pick<APIResponse, "ok" | "dispose">;

/** One render document, followed only by same-origin bundled scripts, styles and fonts. */
export class RenderRequests {
  #documentAllowed = true;
  constructor(readonly origin: string) {}

  async handle<Response extends RenderResponse>(
    route: {
      request: () => RenderRequest;
      fetch: (options: { maxRedirects: number; timeout: number }) => Promise<Response>;
      fulfill: (options: { response: Response }) => Promise<void>;
      abort: (reason: string) => Promise<void>;
    },
    mainFrame: boolean,
  ): Promise<void> {
    const request = route.request();
    const url = new URL(request.url());
    let allowed = false;
    if (
      this.#documentAllowed &&
      request.isNavigationRequest() &&
      mainFrame &&
      request.method() === "GET" &&
      request.url() === `${this.origin}/flow-board-render.html`
    ) {
      this.#documentAllowed = false;
      allowed = true;
    } else if (
      !request.isNavigationRequest() &&
      url.origin === this.origin &&
      request.method() === "GET" &&
      !url.search
    ) {
      allowed =
        (request.resourceType() === "script" && /^\/assets\/[\w.-]+\.js$/.test(url.pathname)) ||
        (request.resourceType() === "stylesheet" &&
          /^\/assets\/[\w.-]+\.css$/.test(url.pathname)) ||
        (request.resourceType() === "font" && /^\/assets\/[\w.-]+\.woff2$/.test(url.pathname));
    }
    // Never continue: redirects must not bypass interception.
    try {
      if (!allowed) {
        await route.abort("blockedbyclient");
        return;
      }
      const response = await route.fetch({ maxRedirects: 0, timeout: 10_000 });
      try {
        if (response.ok()) {
          await route.fulfill({ response });
        } else {
          await route.abort("blockedbyclient");
        }
      } finally {
        await response.dispose();
      }
    } catch {
      await route.abort("blockedbyclient").catch(() => {});
    }
  }
}
