import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TerminalOutput } from "./TerminalOutput";
import type { TerminalOutput as Output } from "../../shared/api/contracts";

const output: Output = {
  pane_id: "w1:p1",
  tab_id: "w1:t1",
  workspace_id: "w1",
  source: "visible",
  format: "text",
  text: "Current screen",
  revision: 1,
  truncated: false,
};
const read = vi.fn();
let client: QueryClient;
let renderer: ReactTestRenderer;
let idle: boolean;
let pane: string;
let scroll: { scrollTop: number; scrollHeight: number; clientHeight: number };
function render() {
  return (
    <QueryClientProvider client={client}>
      <TerminalOutput key={pane} queryKey={["terminal", pane]} read={read} canLoadHistory={idle} />
    </QueryClientProvider>
  );
}
async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 15));
  });
}
function button(label: string) {
  return renderer.root.findAllByType("button").find((node) => node.children.includes(label))!;
}
async function click(label: string) {
  await act(async () => button(label).props.onClick());
  await flush();
}
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  idle = true;
  pane = "w1:p1";
  scroll = { scrollTop: 0, scrollHeight: 1200, clientHeight: 200 };
  read.mockReset().mockImplementation(async (source) => ({
    ...output,
    source,
    text: source === "visible" ? "Current screen" : "Older output\nCurrent screen",
  }));
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  await act(async () => {
    renderer = create(render(), {
      createNodeMock: (node) => (node.type === "pre" ? scroll : null),
    });
  });
  await flush();
});
afterEach(async () => {
  await act(async () => renderer.unmount());
  client.clear();
  vi.unstubAllGlobals();
});

it("polls only the visible screen by default, never history", async () => {
  expect(read).toHaveBeenCalledOnce();
  expect(read.mock.calls[0][0]).toBe("visible");
  expect(renderer.root.findByType("pre").children).toEqual(["Current screen"]);
  expect(JSON.stringify(renderer.toJSON())).not.toContain("ANSI");
  const query = client.getQueryCache().getAll()[0];
  expect(query.observers[0].options.refetchInterval).toBe(1000);
  await act(async () => {
    await client.invalidateQueries({ queryKey: ["terminal", pane] });
  });
  await flush();
  expect(read.mock.calls.map(([source]) => source)).toEqual(["visible", "visible"]);
});

it("loads history once, keeps it scrollable while working, and returns to live explicitly", async () => {
  await click("Load history");
  expect(read.mock.calls.map(([source]) => source)).toEqual(["visible", "recent_unwrapped"]);
  expect(renderer.root.findByType("pre").children).toEqual(["Older output\nCurrent screen"]);
  expect(renderer.root.findByType("pre").props["aria-label"]).toBe("Terminal history snapshot");
  scroll.scrollTop = 123;
  idle = false;
  await act(async () => {
    renderer.root.findByType("pre").props.onScroll();
    renderer.update(render());
    await client.invalidateQueries({ queryKey: ["terminal", pane] });
  });
  await flush();
  expect(button("Refresh history").props.disabled).toBe(true);
  expect(scroll.scrollTop).toBe(123);
  expect(read).toHaveBeenCalledTimes(2);
  expect(client.getQueryCache().getAll()[0].observers[0].options.refetchInterval).toBe(false);
  await click("Return to live");
  expect(read.mock.calls.at(-1)![0]).toBe("visible");
  expect(renderer.root.findByType("pre").children).toEqual(["Current screen"]);
});

it("does not issue history reads while the agent is busy, even through a stale handler", async () => {
  idle = false;
  await act(async () => renderer.update(render()));
  expect(button("Load history").props.disabled).toBe(true);
  await click("Load history");
  expect(read).toHaveBeenCalledOnce();
});

it("keeps live output visible if history loading fails and does not retry", async () => {
  read.mockRejectedValueOnce(new Error("Load history when the agent is idle."));
  await click("Load history");
  expect(renderer.root.findByType("pre").children).toEqual(["Current screen"]);
  expect(JSON.stringify(renderer.toJSON())).toContain("Load history when the agent is idle.");
  expect(read.mock.calls.filter(([source]) => source === "recent_unwrapped")).toHaveLength(1);
});

it("retains an existing history snapshot when refreshing it fails", async () => {
  await click("Load history");
  read.mockRejectedValueOnce(new Error("History unavailable"));
  await click("Refresh history");
  expect(renderer.root.findByType("pre").children).toEqual(["Older output\nCurrent screen"]);
  expect(JSON.stringify(renderer.toJSON())).toContain("History unavailable");
});

it("does not pull a scrolled live screen back to the bottom on refresh", async () => {
  scroll.scrollTop = 100;
  await act(async () => renderer.root.findByType("pre").props.onScroll());
  read.mockResolvedValueOnce({ ...output, revision: 2 });
  await act(async () => {
    await client.invalidateQueries({ queryKey: ["terminal", pane] });
  });
  await flush();
  expect(scroll.scrollTop).toBe(100);
});

it("discards history and ignores a late history response after switching panes", async () => {
  let resolve!: (value: Output) => void;
  let signal!: AbortSignal;
  read.mockImplementationOnce((_source, passedSignal) => {
    signal = passedSignal;
    return new Promise<Output>((done) => {
      resolve = done;
    });
  });
  await click("Load history");
  pane = "w1:p2";
  await act(async () => renderer.update(render()));
  await flush();
  expect(signal.aborted).toBe(true);
  await act(async () =>
    resolve({ ...output, text: "Old pane history", source: "recent_unwrapped" }),
  );
  await flush();
  expect(renderer.root.findByType("pre").children).toEqual(["Current screen"]);
  expect(button("Load history")).toBeDefined();
  expect(JSON.stringify(renderer.toJSON())).not.toContain("Old pane history");
});
