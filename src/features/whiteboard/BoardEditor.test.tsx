import { act, type ReactNode } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ExcalidrawProps } from "@excalidraw/excalidraw/types";
import BoardEditor from "./BoardEditor";
import { deferred, scene } from "./testFixtures";

const mocks = vi.hoisted(() => ({
  props: {} as ExcalidrawProps,
  api: {
    addFiles: vi.fn(),
    updateScene: vi.fn(),
    history: { clear: vi.fn() },
    getSceneElements: vi.fn(),
    getFiles: vi.fn(),
    getAppState: vi.fn(),
  },
  exportToBlob: vi.fn(),
}));
vi.mock("@excalidraw/excalidraw", async () => {
  const { useEffect, useState } = await import("react");
  const Menu = Object.assign(() => null, {
    Item: () => null,
    DefaultItems: { ClearCanvas: () => null },
  });
  return {
    Excalidraw: (props: ExcalidrawProps) => {
      mocks.props = props;
      const [onAPI] = useState(() => props.excalidrawAPI);
      useEffect(() => {
        onAPI?.(mocks.api as never);
      }, [onAPI]);
      return props.children;
    },
    MainMenu: Menu,
    WelcomeScreen: ({ children }: { children: ReactNode }) => children,
    CaptureUpdateAction: { NEVER: "NEVER" },
    restoreElements: (elements: unknown) => elements,
    exportToBlob: mocks.exportToBlob,
    FONT_FAMILY: {},
  };
});
let renderer: ReactTestRenderer;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  vi.unstubAllGlobals();
});
it("ignores normalized/programmatic callbacks but saves human element-version changes", async () => {
  const onChange = vi.fn();
  const onReady = vi.fn();
  const onError = vi.fn();
  const props = { scene: scene(), generation: 1, locked: false, onChange, onReady, onError };
  await act(async () => {
    renderer = create(<BoardEditor {...props} />);
  });
  await act(async () => mocks.props.onChange!(scene().elements as never, {} as never, {}));
  expect(onChange).not.toHaveBeenCalled();
  await act(async () => mocks.props.onChange!(scene(2).elements as never, {} as never, {}));
  expect(onChange).toHaveBeenCalledOnce();
  await act(async () =>
    renderer.update(<BoardEditor {...props} scene={scene(3)} generation={2} />),
  );
  expect(mocks.api.updateScene).toHaveBeenCalledWith(
    expect.objectContaining({ captureUpdate: "NEVER" }),
  );
  expect(mocks.api.history.clear).toHaveBeenCalledOnce();
  await act(async () => mocks.props.onChange!(scene(3).elements as never, {} as never, {}));
  expect(onChange).toHaveBeenCalledOnce();
  expect(mocks.props.validateEmbeddable).toBe(false);
  const preventDefault = vi.fn();
  mocks.props.onLinkOpen!({} as never, { preventDefault } as never);
  expect(preventDefault).toHaveBeenCalledOnce();
});
it("waits for fonts and exports the full nondeleted scene as a bounded white PNG without embedded data", async () => {
  const fonts = deferred<void>();
  vi.stubGlobal("document", { fonts: { ready: fonts.promise, load: vi.fn() } });
  mocks.api.getSceneElements.mockReturnValue([
    ...scene().elements,
    { ...scene(2).elements[0], id: "offscreen" },
    { ...scene(3).elements[0], id: "deleted", isDeleted: true },
  ]);
  mocks.api.getFiles.mockReturnValue({});
  mocks.api.getAppState.mockReturnValue({ selectedElementIds: { box: true } });
  mocks.exportToBlob.mockResolvedValue(new Blob(["PNG"], { type: "image/png" }));
  const onReady = vi.fn();
  await act(async () => {
    renderer = create(
      <BoardEditor
        scene={scene()}
        generation={1}
        locked={false}
        onChange={() => {}}
        onReady={onReady}
        onError={() => {}}
      />,
    );
  });
  const exporting = onReady.mock.calls[0][0].exportPNG();
  await Promise.resolve();
  expect(mocks.exportToBlob).not.toHaveBeenCalled();
  fonts.resolve();
  await exporting;
  expect(mocks.exportToBlob).toHaveBeenCalledWith(
    expect.objectContaining({
      maxWidthOrHeight: 2400,
      mimeType: "image/png",
      appState: expect.objectContaining({
        viewBackgroundColor: "#ffffff",
        exportBackground: true,
        exportEmbedScene: false,
      }),
    }),
  );
  expect(
    mocks.exportToBlob.mock.calls[0][0].elements.map((element: { id: string }) => element.id),
  ).toEqual(["box", "offscreen"]);
});

it("normalizes native optional fields before validating and saving a drawing", async () => {
  const onChange = vi.fn();
  const onError = vi.fn();
  await act(async () => {
    renderer = create(
      <BoardEditor
        scene={scene()}
        generation={1}
        locked={false}
        onChange={onChange}
        onReady={() => {}}
        onError={onError}
      />,
    );
  });
  await act(async () =>
    mocks.props.onChange!(
      [
        {
          ...scene(2).elements[0],
          customData: undefined,
          roundness: { type: 3, value: undefined },
        },
      ] as never,
      {} as never,
      {},
    ),
  );
  expect(onChange).toHaveBeenCalledOnce();
  const saved = onChange.mock.calls[0][0];
  expect(saved.elements[0]).not.toHaveProperty("customData");
  expect(saved.elements[0].roundness).toEqual({ type: 3 });
  expect(onError).toHaveBeenLastCalledWith("");
});

it("reports drawing before idle and keeps text editing active for deferred reconciliation", async () => {
  const order: string[] = [];
  let idle!: FrameRequestCallback;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    idle = callback;
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  mocks.api.getAppState.mockReturnValue({});
  await act(async () => {
    renderer = create(
      <BoardEditor
        scene={scene()}
        generation={1}
        locked={false}
        onChange={() => order.push("change")}
        onReady={() => {}}
        onError={() => {}}
        onInteraction={(active) => order.push(active ? "busy" : "idle")}
      />,
    );
  });
  await act(async () => mocks.props.onPointerDown!({} as never, {} as never));
  await act(async () => mocks.props.onChange!(scene(2).elements as never, {} as never, {}));
  expect(order).toEqual(["busy", "change", "busy"]);
  await act(async () => mocks.props.onPointerUp!({} as never, {} as never));
  expect(order.at(-1)).toBe("busy");
  await act(async () => idle(0));
  expect(order.at(-1)).toBe("idle");
  await act(async () =>
    mocks.props.onChange!(
      scene(2).elements as never,
      { editingTextElement: scene().elements[0] } as never,
      {},
    ),
  );
  expect(order.at(-1)).toBe("busy");
});

it("rejects unsupported scene types instead of saving embedded web content", async () => {
  const onChange = vi.fn();
  const onError = vi.fn();
  await act(async () => {
    renderer = create(
      <BoardEditor
        scene={scene()}
        generation={1}
        locked={false}
        onChange={onChange}
        onReady={() => {}}
        onError={onError}
      />,
    );
  });
  await act(async () =>
    mocks.props.onChange!(
      [{ ...scene().elements[0], type: "embeddable" }] as never,
      {} as never,
      {},
    ),
  );
  expect(onChange).not.toHaveBeenCalled();
  expect(onError).toHaveBeenCalledWith(expect.stringContaining("unsupported"));
});
