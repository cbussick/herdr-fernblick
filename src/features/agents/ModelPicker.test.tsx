import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ModelPicker } from "./ModelPicker";

const api = vi.hoisted(() => ({ models: vi.fn(), change: vi.fn() }));
vi.mock("../../shared/api/apiClient", () => ({
  getAgentModels: api.models,
  setAgentModel: api.change,
}));
const target = { runtime: "runtime", epoch: "epoch", sessionId: "session" };
const models = [
  { id: "sonnet", provider: "anthropic", name: "Sonnet" },
  { id: "gpt", provider: "openai", name: "GPT" },
];
let renderer: ReactTestRenderer;
let client: QueryClient;
let props: Parameters<typeof ModelPicker>[0];
function view() {
  return (
    <QueryClientProvider client={client}>
      <ModelPicker {...props} />
    </QueryClientProvider>
  );
}
async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 15));
  });
}
async function open() {
  await act(async () =>
    renderer.root.findByProps({ "aria-label": "Change model" }).props.onClick(),
  );
  await flush();
}
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  props = {
    pane: "w1:p1",
    target,
    connected: true,
    enabled: true,
    supported: true,
    model: "sonnet",
    provider: "anthropic",
  };
  api.models.mockReset().mockResolvedValue({ models, truncated: false });
  api.change.mockReset().mockResolvedValue({});
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
  props = { ...props, supported: false };
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
