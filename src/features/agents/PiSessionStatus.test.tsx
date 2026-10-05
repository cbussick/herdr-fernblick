import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { PiSessionStatus } from "./PiSessionStatus";

it("renders both full footer lines as escaped text with colors rather than the approximate snapshot fields", () => {
  const html = renderToStaticMarkup(
    <PiSessionStatus
      status={{
        cwd: "fallback-dir",
        model: "fallback-model",
        totalTokens: 999,
        cost: 999,
        footerLines: [
          "\x1b[38;2;246;226;183mreal-model high\x1b[0m · ~/full/path",
          "\x1b[2m↑20k R500 CH50.0% $1.234 <img src=x onerror=alert(1)>\x1b[0m",
        ],
      }}
    />,
  );
  expect(html.match(/data-testid="pi-footer-line"/g)).toHaveLength(2);
  expect(html).toContain("--terminal-foreground:rgb(246, 226, 183)");
  expect(html).toContain('data-dim=""');
  expect(html).toContain("real-model high");
  expect(html).toContain("~/full/path");
  expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  expect(html).not.toContain("<img");
  expect(html).not.toContain("fallback-model");
  expect(html).not.toContain("displayed tokens");
  expect(html).not.toContain("\x1b");
});

it("keeps the legacy fallback when the publisher is absent", () => {
  const html = renderToStaticMarkup(
    <PiSessionStatus
      status={{ cwd: "/cwd", model: "model", provider: "provider", totalTokens: 120, cost: 1.23 }}
    />,
  );
  expect(html).toContain("model · /cwd");
  expect(html).toContain("120 displayed tokens · $1.23 · provider");
});
