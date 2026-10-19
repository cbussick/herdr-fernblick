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
  saveDefault: vi.fn(),
}));
vi.mock("../../shared/api/apiClient", () => ({
  getAgentModels: api.models,
  setAgentModel: api.change,
  getAgentThinkingLevels: api.thinking,
  setAgentThinkingLevel: api.changeThinking,
  saveAgentGlobalDefault: api.saveDefault,
}));
const target = { runtime: "runtime", epoch: "epoch", sessionId: "session" };
const defaults = { model: { provider: "anthropic", modelId: "sonnet" }, thinkingLevel: "medium" };
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
    defaultsSupported: true,
    model: "sonnet",
    provider: "anthropic",
  };
  api.models.mockReset().mockResolvedValue({ models, truncated: false, defaults });
  api.change.mockReset().mockResolvedValue({});
  api.thinking.mockReset().mockResolvedValue({
    provider: "anthropic",
    modelId: "sonnet",
    level: "medium",
    levels: ["low", "medium", "high"],
    defaults,
  });
  api.changeThinking.mockReset().mockResolvedValue({});
  api.saveDefault.mockReset().mockResolvedValue({});
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
function defaultButtons() {
  return renderer.root
    .findAllByType("button")
    .filter((button) => button.props["data-testid"] === "global-default");
}
function defaultButton() {
  return defaultButtons().find((button) => !button.props["data-default"])!;
}
it.each(["model", "thinking"])(
  "saves a non-current %s from its row without switching or closing, and moves the Default marker",
  async (kind) => {
    if (kind === "model") await open();
    else await openThinking();
    expect(api.saveDefault).not.toHaveBeenCalled();
    expect(defaultButton().props.type).toBe("button");
    await act(async () => defaultButton().props.onClick());
    expect(api.saveDefault).toHaveBeenCalledExactlyOnceWith("w1:p1", target, {
      kind,
      provider: kind === "model" ? "openai" : "anthropic",
      modelId: kind === "model" ? "gpt" : "sonnet",
      ...(kind === "thinking" ? { level: "low" } : {}),
    });
    expect(renderer.root.findByProps({ role: "status" }).children.join("")).toContain(
      "saved as global default",
    );
    const saved = defaultButtons().filter((button) => button.props["data-default"]);
    expect(saved).toHaveLength(1);
    expect(saved[0].props["aria-label"]).toBe(
      kind === "model" ? "Global default: GPT (openai)" : "Global default: Low",
    );
    expect(
      renderer.root.findByProps({ "aria-pressed": true }).findByType("strong").children.join(""),
    ).toContain(kind === "model" ? "Sonnet" : "Medium");
    expect(renderer.root.findAllByType("footer")).toHaveLength(0);
    expect(JSON.stringify(renderer.toJSON())).not.toContain("For new Pi sessions");
    expect(renderer.root.findAllByType("dialog")).toHaveLength(1);
    expect(api.change).not.toHaveBeenCalled();
    expect(api.changeThinking).not.toHaveBeenCalled();
  },
);
it.each(["model", "thinking"])(
  "serializes %s default saves against selection and shows failures without retry",
  async (kind) => {
    let reject!: (error: Error) => void;
    api.saveDefault.mockImplementationOnce(
      () =>
        new Promise((_resolve, fail) => {
          reject = fail;
        }),
    );
    if (kind === "model") await open();
    else await openThinking();
    const save = defaultButton();
    const option = renderer.root.findAllByProps({ "aria-pressed": false })[0];
    await act(async () => {
      save.props.onClick();
      save.props.onClick();
      option.props.onClick();
    });
    expect(api.saveDefault).toHaveBeenCalledOnce();
    expect(api.change).not.toHaveBeenCalled();
    expect(api.changeThinking).not.toHaveBeenCalled();
    expect(defaultButton().props["aria-disabled"]).toBe(true);
    expect(
      defaultButtons().find((button) => button.props["data-default"])!.props["aria-label"],
    ).toBe(kind === "model" ? "Global default: Sonnet (anthropic)" : "Global default: Medium");
    expect(option.props.disabled).toBe(true);
    expect(renderer.root.findByProps({ role: "status" }).children.join("")).toContain(
      "Saving global default",
    );
    await act(async () => reject(new Error("Settings unavailable")));
    expect(renderer.root.findByProps({ role: "alert" }).children.join("")).toContain(
      "Settings unavailable",
    );
    expect(defaultButton().props["aria-disabled"]).toBe(false);
    expect(
      defaultButtons().find((button) => button.props["data-default"])!.props["aria-label"],
    ).toBe(kind === "model" ? "Global default: Sonnet (anthropic)" : "Global default: Medium");
    expect(api.saveDefault).toHaveBeenCalledOnce();
  },
);
it.each(["model", "thinking"])(
  "gates %s defaults for legacy peers and busy sessions",
  async (kind) => {
    props = { ...props, defaultsSupported: false };
    await act(async () => renderer.update(view()));
    if (kind === "model") await open();
    else await openThinking();
    expect(defaultButton().props["aria-disabled"]).toBe(true);
    await act(async () => defaultButton().props.onClick());
    expect(api.saveDefault).not.toHaveBeenCalled();
    expect(JSON.stringify(renderer.toJSON())).toContain("Run /reload");
    props = { ...props, defaultsSupported: true, enabled: false };
    await act(async () => renderer.update(view()));
    expect(defaultButton().props["aria-disabled"]).toBe(true);
    await act(async () => defaultButton().props.onClick());
    expect(api.saveDefault).not.toHaveBeenCalled();
  },
);
it.each(["model", "thinking"])(
  "reads the saved %s marker independently from Current on every opening",
  async (kind) => {
    const persisted = { model: { provider: "openai", modelId: "gpt" }, thinkingLevel: "high" };
    api.models.mockResolvedValue({ models, truncated: false, defaults: persisted });
    api.thinking.mockResolvedValue({
      provider: "anthropic",
      modelId: "sonnet",
      level: "medium",
      levels: ["low", "medium", "high"],
      defaults: persisted,
    });
    for (let attempt = 0; attempt < 2; attempt++) {
      if (kind === "model") await open();
      else await openThinking();
      const saved = defaultButtons().filter((button) => button.props["data-default"]);
      expect(saved).toHaveLength(1);
      expect(saved[0].props["aria-label"]).toBe(
        kind === "model" ? "Global default: GPT (openai)" : "Global default: High",
      );
      expect(saved[0].props["aria-disabled"]).toBe(true);
      await act(async () => saved[0].props.onClick());
      expect(api.saveDefault).not.toHaveBeenCalled();
      expect(
        renderer.root.findByProps({ "aria-pressed": true }).findByType("strong").children.join(""),
      ).toContain(kind === "model" ? "Sonnet" : "Medium");
      await act(async () => renderer.root.findByType("dialog").props.onClose());
    }
    expect(kind === "model" ? api.models : api.thinking).toHaveBeenCalledTimes(2);
  },
);
it("matches default models by provider and ID, and keeps indicators while filtering", async () => {
  api.models.mockResolvedValue({
    models: [...models, { ...models[0], provider: "other" }],
    truncated: false,
    defaults,
  });
  await open();
  expect(defaultButtons().filter((button) => button.props["data-default"])).toHaveLength(1);
  await act(async () =>
    renderer.root
      .findByProps({ "aria-label": "Search models" })
      .props.onChange({ target: { value: "other" } }),
  );
  expect(defaultButtons()).toHaveLength(1);
  expect(defaultButtons()[0].props["data-default"]).toBe(false);
  await act(async () =>
    renderer.root
      .findByProps({ "aria-label": "Search models" })
      .props.onChange({ target: { value: "anthropic" } }),
  );
  expect(defaultButtons()[0].props["data-default"]).toBe(true);
});
it.each(["model", "thinking"])(
  "does not infer a %s default from Current when no explicit default exists",
  async (kind) => {
    const empty = { model: null, thinkingLevel: null };
    api.models.mockResolvedValue({ models, truncated: false, defaults: empty });
    api.thinking.mockResolvedValue({
      provider: "anthropic",
      modelId: "sonnet",
      level: "medium",
      levels: ["low", "medium", "high"],
      defaults: empty,
    });
    if (kind === "model") await open();
    else await openThinking();
    expect(defaultButtons().some((button) => button.props["data-default"])).toBe(false);
    expect(defaultButton().props["aria-disabled"]).toBe(false);
  },
);
it("keeps session selection available on defaults-read failure and supports explicit retry", async () => {
  api.models.mockResolvedValueOnce({
    models,
    truncated: false,
    defaultsError: "Global defaults unavailable",
  });
  await open();
  expect(renderer.root.findByProps({ role: "alert" }).findByType("p").children.join("")).toContain(
    "unavailable",
  );
  expect(defaultButton().props["aria-disabled"]).toBe(true);
  expect(renderer.root.findByProps({ "aria-pressed": false }).props.disabled).toBe(false);
  await act(async () =>
    renderer.root
      .findAllByType("button")
      .find((button) => button.children.includes("Retry defaults"))!
      .props.onClick(),
  );
  await flush();
  expect(defaultButton().props["aria-disabled"]).toBe(false);
  expect(api.models).toHaveBeenCalledTimes(2);
});
it("gates row saves for an older defaults-capable bridge without default metadata", async () => {
  api.models.mockResolvedValue({ models, truncated: false });
  await open();
  expect(defaultButton().props["aria-disabled"]).toBe(true);
  await act(async () => defaultButton().props.onClick());
  expect(api.saveDefault).not.toHaveBeenCalled();
  expect(JSON.stringify(renderer.toJSON())).toContain("Run /reload");
});
it("discards late default-save results after target replacement", async () => {
  let finish!: () => void;
  api.saveDefault.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  await open();
  await act(async () => defaultButton().props.onClick());
  props = { ...props, target: { ...target, epoch: "replacement" } };
  await act(async () => renderer.update(view()));
  await open();
  await act(async () => finish());
  expect(renderer.root.findAllByProps({ role: "status" })).toHaveLength(0);
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
