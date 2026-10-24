import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vitest";
import { usePaneNavigation } from "./usePaneNavigation";

let renderer: ReactTestRenderer;
afterEach(async () => {
  await act(async () => renderer?.unmount());
  vi.unstubAllGlobals();
});
function Navigation() {
  const [pane, navigate] = usePaneNavigation();
  return (
    <button data-pane={pane} onClick={() => navigate(null)}>
      Back
    </button>
  );
}
it("gives a direct terminal link a local overview history entry", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const browser = new EventTarget();
  let url = new URL("https://fernblick.example/?pane=w1%3Ap2&session=s&whiteboard=1");
  const entries: { state: unknown; url: string }[] = [
    { state: null, url: "https://external.example/" },
    { state: null, url: url.href },
  ];
  let index = 1;
  const location = {
    get href() {
      return url.href;
    },
    get search() {
      return url.search;
    },
  };
  const history = {
    get state() {
      return entries[index].state;
    },
    replaceState(state: unknown, _title: string, next?: string) {
      if (next) url = new URL(next, url);
      entries[index] = { state, url: url.href };
    },
    pushState(state: unknown, _title: string, next?: string) {
      if (next) url = new URL(next, url);
      entries.splice(index + 1, Infinity, { state, url: url.href });
      index++;
    },
    back() {
      index--;
      url = new URL(entries[index].url);
      browser.dispatchEvent(Object.assign(new Event("popstate"), { state: entries[index].state }));
    },
  };
  Object.assign(browser, { location, history });
  vi.stubGlobal("window", browser);
  await act(async () => {
    renderer = create(<Navigation />);
  });
  expect(renderer.root.findByType("button").props["data-pane"]).toBe("w1:p2");
  expect(entries).toHaveLength(3);
  expect(entries[1].url).toBe("https://fernblick.example/");
  await act(async () => renderer.root.findByType("button").props.onClick());
  expect(index).toBe(1);
  expect(renderer.root.findByType("button").props["data-pane"]).toBeNull();
  expect(url.origin).toBe("https://fernblick.example");
});
