import { act, createRef } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ConversationSettings, type ConversationSettingsProps } from "./ConversationSettings";

const api = vi.hoisted(() => ({
  models: vi.fn(),
  change: vi.fn(),
  thinking: vi.fn(),
  changeThinking: vi.fn(),
}));
vi.mock("../../shared/api/apiClient", () => ({
  getAgentModels: api.models,
  setAgentModel: api.change,
  getAgentThinkingLevels: api.thinking,
  setAgentThinkingLevel: api.changeThinking,
}));
const target = { runtime: "runtime", epoch: "epoch", sessionId: "session" };
const models = [
  { id: "sonnet", provider: "anthropic", name: "Sonnet" },
  { id: "gpt", provider: "openai", name: "GPT" },
];
let renderer: ReactTestRenderer;
let client: QueryClient;
let props: ConversationSettingsProps;
const triggerRef = createRef<HTMLButtonElement>();
function view() {
  return (
    <QueryClientProvider client={client}>
      <ConversationSettings settings={props} triggerRef={triggerRef}>
        {(actions) => (
          <>
            {actions.map((action) => (
              <button
                key={action.id}
                type="button"
                role="menuitem"
                aria-label={action.label}
                onClick={action.onSelect}
              >
                {action.icon}
                {action.label}
              </button>
            ))}
          </>
        )}
      </ConversationSettings>
    </QueryClientProvider>
  );
}
async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 15));
  });
}
async function open() {
  await act(async () => renderer.root.findByProps({ "aria-label": "Model" }).props.onClick());
  await flush();
}
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  props = {
    pane: "w1:p1",
    target,
    connected: true,
    enabled: true,
    modelsSupported: true,
    thinkingSupported: true,
    model: "sonnet",
    provider: "anthropic",
  };
  api.models.mockReset().mockResolvedValue({ models, truncated: false });
  api.change.mockReset().mockResolvedValue({});
  api.thinking.mockReset().mockResolvedValue({
    provider: "anthropic",
    modelId: "sonnet",
    level: "medium",
    levels: ["low", "medium", "high"],
  });
  api.changeThinking.mockReset().mockResolvedValue({});
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    renderer = create(view(), {
      createNodeMock: () => ({ showModal: vi.fn(), close: vi.fn(), focus: vi.fn() }),
    });
  });
});
afterEach(async () => {
  await act(async () => renderer.unmount());
  client.clear();
  vi.unstubAllGlobals();
});
it("fetches only on opening, searches providers, marks current and explicitly switches without sending", async () => {
  expect(api.models).not.toHaveBeenCalled();
  await open();
  expect(api.models).toHaveBeenCalledOnce();
  expect(renderer.root.findAllByProps({ "aria-pressed": true })).toHaveLength(1);
  await act(async () =>
    renderer.root
      .findByProps({ "aria-label": "Search models" })
      .props.onChange({ target: { value: "openai" } }),
  );
  const options = renderer.root.findAllByProps({ "aria-pressed": false });
  expect(options).toHaveLength(1);
  expect(api.change).not.toHaveBeenCalled();
  const event = { key: "Enter", preventDefault: vi.fn() };
  await act(async () =>
    renderer.root.findByProps({ "aria-label": "Search models" }).props.onKeyDown(event),
  );
  expect(event.preventDefault).toHaveBeenCalledOnce();
  expect(api.change).not.toHaveBeenCalled();
  await act(async () => options[0].props.onClick());
  expect(api.change).toHaveBeenCalledExactlyOnceWith("w1:p1", target, "openai", "gpt");
  expect(renderer.root.findAllByType("dialog")).toHaveLength(0);
});
it("retains errors for explicit retry and serializes double selection", async () => {
  let reject!: (error: Error) => void;
  api.change.mockImplementationOnce(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
  );
  await open();
  const option = renderer.root.findByProps({ "aria-pressed": false });
  await act(async () => {
    option.props.onClick();
    option.props.onClick();
  });
  expect(api.change).toHaveBeenCalledOnce();
  expect(renderer.root.findByProps({ role: "status" }).children.join("")).toContain(
    "Changing model",
  );
  await act(async () => reject(new Error("Outcome uncertain. Check Pi.")));
  expect(renderer.root.findByProps({ role: "alert" }).children.join("")).toContain("uncertain");
  expect(renderer.root.findAllByType("dialog")).toHaveLength(1);
  expect(api.change).toHaveBeenCalledOnce();
});
it("closes on target replacement or disconnect and ignores old async results", async () => {
  let finish!: () => void;
  api.change.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  await open();
  await act(async () => renderer.root.findByProps({ "aria-pressed": false }).props.onClick());
  props = { ...props, target: { ...target, epoch: "replacement" } };
  await act(async () => renderer.update(view()));
  expect(renderer.root.findAllByType("dialog")).toHaveLength(0);
  await act(async () => finish());
  await open();
  props = { ...props, connected: false };
  await act(async () => renderer.update(view()));
  expect(renderer.root.findAllByType("dialog")).toHaveLength(0);
  expect(api.change).toHaveBeenCalledOnce();
});
it("explains legacy capability and never fetches unsupported models", async () => {
  props = { ...props, modelsSupported: false };
  await act(async () => renderer.update(view()));
  await open();
  expect(JSON.stringify(renderer.toJSON())).toContain("Run /reload");
  expect(api.models).not.toHaveBeenCalled();
});
it("gates selection when Pi becomes busy without changing the draft", async () => {
  await open();
  props = { ...props, enabled: false };
  await act(async () => renderer.update(view()));
  const option = renderer.root.findByProps({ "aria-pressed": false });
  expect(option.props.disabled).toBe(true);
  await act(async () => option.props.onClick());
  expect(api.change).not.toHaveBeenCalled();
});
async function openThinking() {
  await act(async () =>
    renderer.root.findByProps({ "aria-label": "Thinking level" }).props.onClick(),
  );
  await flush();
}
it("opens thinking only on selection and shows supported levels with current selection", async () => {
  expect(api.thinking).not.toHaveBeenCalled();
  await openThinking();
  expect(api.thinking).toHaveBeenCalledOnce();
  expect(renderer.root.findAllByProps({ "aria-pressed": true })).toHaveLength(1);
  expect(renderer.root.findAllByProps({ "aria-pressed": false })).toHaveLength(2);
  expect(api.changeThinking).not.toHaveBeenCalled();
  await act(async () => renderer.root.findAllByProps({ "aria-pressed": false })[1].props.onClick());
  expect(api.changeThinking).toHaveBeenCalledExactlyOnceWith(
    "w1:p1",
    target,
    "anthropic",
    "sonnet",
    "high",
  );
  expect(renderer.root.findAllByType("dialog")).toHaveLength(0);
  expect(api.change).not.toHaveBeenCalled();
});
it("preserves thinking errors and prevents double invocation", async () => {
  let reject!: (error: Error) => void;
  api.changeThinking.mockImplementationOnce(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
  );
  await openThinking();
  const high = renderer.root.findAllByProps({ "aria-pressed": false })[1];
  await act(async () => {
    high.props.onClick();
    high.props.onClick();
  });
  expect(api.changeThinking).toHaveBeenCalledOnce();
  await act(async () => reject(new Error("Outcome uncertain. Check Pi.")));
  expect(renderer.root.findByProps({ role: "alert" }).children.join("")).toContain("uncertain");
  expect(renderer.root.findAllByType("dialog")).toHaveLength(1);
  expect(api.changeThinking).toHaveBeenCalledOnce();
});
it("closes thinking on model replacement, session replacement and disconnect", async () => {
  await openThinking();
  props = { ...props, model: "other" };
  await act(async () => renderer.update(view()));
  expect(renderer.root.findAllByType("dialog")).toHaveLength(0);
  props = { ...props, model: "sonnet" };
  await act(async () => renderer.update(view()));
  await openThinking();
  props = { ...props, target: { ...target, epoch: "new" } };
  await act(async () => renderer.update(view()));
  expect(renderer.root.findAllByType("dialog")).toHaveLength(0);
  await openThinking();
  props = { ...props, connected: false };
  await act(async () => renderer.update(view()));
  expect(renderer.root.findAllByType("dialog")).toHaveLength(0);
  expect(api.changeThinking).not.toHaveBeenCalled();
});
it("shows reload notice for legacy peers and only Off for non-reasoning models", async () => {
  props = { ...props, thinkingSupported: false };
  await act(async () => renderer.update(view()));
  await openThinking();
  expect(JSON.stringify(renderer.toJSON())).toContain("Run /reload");
  expect(api.thinking).not.toHaveBeenCalled();
  await act(async () =>
    renderer.root.findByProps({ "aria-label": "Close thinking level picker" }).props.onClick(),
  );
  props = { ...props, thinkingSupported: true };
  api.thinking.mockResolvedValue({
    provider: "anthropic",
    modelId: "sonnet",
    level: "off",
    levels: ["off"],
  });
  await act(async () => renderer.update(view()));
  await openThinking();
  expect(JSON.stringify(renderer.toJSON())).toContain("does not support thinking");
  expect(renderer.root.findAllByProps({ "aria-pressed": true })).toHaveLength(1);
  expect(renderer.root.findAllByProps({ "aria-pressed": false })).toHaveLength(0);
});
it("disables thinking selection on busy state or model-mismatched catalogue", async () => {
  await openThinking();
  props = { ...props, enabled: false };
  await act(async () => renderer.update(view()));
  const high = renderer.root.findAllByProps({ "aria-pressed": false })[1];
  expect(high.props.disabled).toBe(true);
  await act(async () => high.props.onClick());
  expect(api.changeThinking).not.toHaveBeenCalled();
  await act(async () =>
    renderer.root.findByProps({ "aria-label": "Close thinking level picker" }).props.onClick(),
  );
  props = { ...props, enabled: true };
  api.thinking.mockResolvedValue({
    provider: "other",
    modelId: "sonnet",
    level: "medium",
    levels: ["medium", "high"],
  });
  await act(async () => renderer.update(view()));
  await openThinking();
  expect(renderer.root.findByProps({ "aria-pressed": false }).props.disabled).toBe(true);
  expect(JSON.stringify(renderer.toJSON())).toContain("Model changed");
});
it("shows discovery errors with explicit retry and no mutation", async () => {
  api.thinking.mockRejectedValueOnce(new Error("Thinking unavailable"));
  await openThinking();
  expect(renderer.root.findByProps({ role: "alert" })).toBeDefined();
  await act(async () =>
    renderer.root
      .findAllByType("button")
      .find((button) => button.children.includes("Retry"))!
      .props.onClick(),
  );
  await flush();
  expect(api.thinking).toHaveBeenCalledTimes(2);
  expect(api.changeThinking).not.toHaveBeenCalled();
});
it("supports empty, failed catalogue and explicit discovery retry", async () => {
  api.models.mockRejectedValueOnce(new Error("Catalogue unavailable"));
  await open();
  expect(renderer.root.findByProps({ role: "alert" })).toBeDefined();
  api.models.mockResolvedValueOnce({ models: [], truncated: false });
  await act(async () =>
    renderer.root
      .findAllByType("button")
      .find((button) => button.children.includes("Retry"))!
      .props.onClick(),
  );
  await flush();
  expect(JSON.stringify(renderer.toJSON())).toContain("No models available");
  expect(api.change).not.toHaveBeenCalled();
});
