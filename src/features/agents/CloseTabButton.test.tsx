import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it } from "vitest";
import { CloseTabButton } from "./CloseTabButton";

it.each([true, false])("shows Pi-only editing controls only when supported (%s)", (supportsPi) => {
  const client = new QueryClient();
  const html = renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <CloseTabButton
        agentRunning
        agentName="test"
        agentTarget="w1:p1"
        agentStatus="idle"
        supportsPi={supportsPi}
        label="My CLI"
        tabId="w1:t1"
        onClosed={() => {}}
      />
    </QueryClientProvider>,
  );
  expect(html.includes("Show thinking chips")).toBe(supportsPi);
  expect(html.includes("Restart agent session")).toBe(supportsPi);
  expect(html.includes("Exit agent session")).toBe(supportsPi);
  expect(html).toContain("Agent name");
  expect(html).toContain("Close this tab");
  client.clear();
});
