import { act, createRef } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ConversationActionsMenu, type ConversationAction } from "./ConversationActionsMenu";

let renderer: ReactTestRenderer;
const first = vi.fn();
const second = vi.fn();
const third = vi.fn();
const triggerRef = createRef<HTMLButtonElement>();
const actions: ConversationAction[] = [
  { id: "first", label: "First", onSelect: first },
  { id: "second", label: "Second", disabledReason: "Unavailable now", onSelect: second },
  { id: "third", label: "Third", onSelect: third },
];
function view(contextKey = "initial", disabled = false) {
  return (
    <ConversationActionsMenu
      actions={actions}
      contextKey={contextKey}
      disabled={disabled}
      triggerRef={triggerRef}
    >
      {(trigger) => <div>{trigger}</div>}
    </ConversationActionsMenu>
  );
}
const trigger = () => renderer.root.findByProps({ "data-ui": "conversation-actions-button" });
const menu = () => renderer.root.findByProps({ role: "menu" });
const items = () => renderer.root.findAllByProps({ role: "menuitem" });
function key(value: string) {
  return { key: value, preventDefault: vi.fn(), stopPropagation: vi.fn() };
}
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  first.mockReset();
  second.mockReset();
  third.mockReset();
  await act(async () => {
    renderer = create(view());
  });
});
afterEach(async () => {
  await act(async () => renderer.unmount());
  vi.unstubAllGlobals();
});
it("supports a list of actions, disabled reasons and explicit selection without invoking on open", async () => {
  await act(async () => trigger().props.onClick());
  expect(items()).toHaveLength(3);
  expect(trigger().props["aria-haspopup"]).toBe("menu");
  expect(first).not.toHaveBeenCalled();
  expect(items()[1].props["aria-disabled"]).toBe(true);
  expect(items()[1].props["aria-describedby"]).toBe(items()[1].findByType("small").props.id);
  await act(async () => items()[1].props.onClick());
  expect(items()).toHaveLength(3);
  expect(second).not.toHaveBeenCalled();
  await act(async () => items()[2].props.onClick());
  expect(third).toHaveBeenCalledOnce();
  expect(items()).toHaveLength(0);
});
it("opens at the first/last action and implements roving Arrow/Home/End keyboard navigation", async () => {
  const up = key("ArrowUp");
  await act(async () => trigger().props.onKeyDown(up));
  expect(up.preventDefault).toHaveBeenCalledOnce();
  expect(items().map((item) => item.props.tabIndex)).toEqual([-1, -1, 0]);
  await act(async () => menu().props.onKeyDown(key("ArrowDown")));
  expect(items().map((item) => item.props.tabIndex)).toEqual([0, -1, -1]);
  await act(async () => menu().props.onKeyDown(key("ArrowUp")));
  expect(items()[2].props.tabIndex).toBe(0);
  await act(async () => menu().props.onKeyDown(key("Home")));
  expect(items()[0].props.tabIndex).toBe(0);
  await act(async () => menu().props.onKeyDown(key("End")));
  expect(items()[2].props.tabIndex).toBe(0);
});
it.each(["Escape", "Tab"])("closes with %s without choosing an action", async (value) => {
  await act(async () => trigger().props.onClick());
  const event = key(value);
  await act(async () => menu().props.onKeyDown(event));
  expect(items()).toHaveLength(0);
  expect(first).not.toHaveBeenCalled();
  if (value === "Escape") expect(event.preventDefault).toHaveBeenCalledOnce();
  else expect(event.preventDefault).not.toHaveBeenCalled();
});
it("synchronizes native light dismissal, context changes and a newly locked composer", async () => {
  await act(async () => trigger().props.onClick());
  await act(async () => menu().props.onToggle({ newState: "closed" }));
  expect(items()).toHaveLength(0);
  await act(async () => trigger().props.onClick());
  await act(async () => renderer.update(view("replacement")));
  expect(items()).toHaveLength(0);
  await act(async () => trigger().props.onClick());
  await act(async () => renderer.update(view("replacement", true)));
  expect(items()).toHaveLength(0);
  expect(trigger().props.disabled).toBe(true);
  await act(async () => trigger().props.onClick());
  expect(items()).toHaveLength(0);
});
