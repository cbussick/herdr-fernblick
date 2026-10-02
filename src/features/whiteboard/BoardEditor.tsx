import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  CaptureUpdateAction,
  Excalidraw,
  FONT_FAMILY,
  MainMenu,
  WelcomeScreen,
  exportToBlob,
  restoreElements,
} from "@excalidraw/excalidraw";
import type { BinaryFiles, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import "@excalidraw/excalidraw/index.css";
import {
  MAX_BOARD_BYTES,
  boardSceneSchema,
  type BoardScene,
} from "../../../packages/pi-live-chat/boardProtocol";
import { downloadScene, sceneFingerprint } from "./scene";
import { editorChanges } from "./mergeScene";
import styles from "./Whiteboard.module.css";

export interface EditorHandle {
  exportPNG: () => Promise<Blob>;
}
export interface BoardEditorProps {
  scene: BoardScene;
  generation: number;
  locked: boolean;
  onChange: (scene: BoardScene) => void;
  onReady: (handle: EditorHandle | null) => void;
  onError: (message: string) => void;
  onInteraction?: (active: boolean) => void;
}
function restored(scene: BoardScene) {
  return restoreElements(scene.elements as unknown as ExcalidrawElement[], null, {
    repairBindings: true,
  });
}
function asScene(elements: readonly ExcalidrawElement[], files: BinaryFiles): BoardScene {
  // Reject unsupported iframe/embeddable content rather than silently losing it.
  const usedFiles = new Set<string | null>(
    elements.filter((element) => element.type === "image").map((element) => element.fileId),
  );
  const sceneFiles = Object.fromEntries(Object.entries(files).filter(([id]) => usedFiles.has(id)));
  // Native records contain optional undefined fields (for example customData).
  // Normalize at the JSON boundary, exactly as the HTTP transport does.
  const json = JSON.stringify({ elements, files: sceneFiles, background: "#ffffff" });
  if (new TextEncoder().encode(json).byteLength > MAX_BOARD_BYTES)
    throw new Error("Board exceeds 12 MiB");
  return boardSceneSchema.parse(JSON.parse(json));
}

export default function BoardEditor({
  scene,
  generation,
  locked,
  onChange,
  onReady,
  onError,
  onInteraction,
}: BoardEditorProps) {
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const [initial] = useState(() => ({
    scrollToContent: true,
    elements: restored(scene),
    files: scene.files as unknown as BinaryFiles,
    appState: { viewBackgroundColor: "#ffffff", exportBackground: true, exportEmbedScene: false },
  }));
  const [initialFingerprint] = useState(() =>
    sceneFingerprint(asScene(initial.elements, initial.files)),
  );
  const baseline = useRef(initialFingerprint);
  const editorBase = useRef(asScene(initial.elements, initial.files));
  const rawBase = useRef(scene);
  const pointer = useRef(false);
  const idleFrame = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (idleFrame.current !== null) cancelAnimationFrame(idleFrame.current);
    },
    [],
  );
  const appliedGeneration = useRef(generation);
  const applying = useRef(false);
  const current = useRef({ scene, onChange, onError, onReady, onInteraction });
  useLayoutEffect(() => {
    current.current = { scene, onChange, onError, onReady, onInteraction };
  });

  useEffect(() => {
    if (!api || appliedGeneration.current === generation) return;
    const next = current.current.scene;
    const elements = restored(next);
    applying.current = true;
    editorBase.current = asScene(elements, next.files as unknown as BinaryFiles);
    rawBase.current = next;
    baseline.current = sceneFingerprint(editorBase.current);
    api.addFiles(Object.values(next.files) as unknown as Parameters<typeof api.addFiles>[0]);
    api.updateScene({
      elements,
      appState: { viewBackgroundColor: "#ffffff" },
      captureUpdate: CaptureUpdateAction.NEVER,
    });
    // Controller reconciles first and defers updates during gestures. Local undo must never undo
    // the agent's work or resurrect content from an older revision.
    api.history.clear();
    appliedGeneration.current = generation;
    applying.current = false;
  }, [api, generation]);

  useEffect(() => {
    if (!api) return;
    current.current.onReady({
      exportPNG: async () => {
        const elements = api.getSceneElements().filter((element) => !element.isDeleted);
        if (!elements.length) throw new Error("Draw something before sending.");
        // Off-screen text must also have its fonts loaded before rasterization.
        await Promise.all(
          elements
            .filter((element) => element.type === "text")
            .map((element) => {
              const family = Object.entries(FONT_FAMILY).find(
                ([, id]) => id === element.fontFamily,
              )?.[0];
              return family
                ? document.fonts.load(`${element.fontSize}px "${family}"`, element.text)
                : Promise.resolve([]);
            }),
        );
        await document.fonts.ready;
        const blob = await exportToBlob({
          elements,
          files: api.getFiles(),
          mimeType: "image/png",
          maxWidthOrHeight: 2400,
          appState: {
            ...api.getAppState(),
            viewBackgroundColor: "#ffffff",
            exportBackground: true,
            exportEmbedScene: false,
            exportWithDarkMode: false,
            frameRendering: { enabled: false, clip: false, name: false, outline: false },
          },
        });
        if (!blob.size || blob.size >= 10 * 1024 * 1024)
          throw new Error(
            "The PNG must be smaller than 10 MiB. Simplify the drawing before sending.",
          );
        return blob;
      },
    });
    return () => current.current.onReady(null);
  }, [api]);

  return (
    <div
      className={styles.editor}
      data-testid="whiteboard-editor"
      onClickCapture={(event) => {
        if (event.target instanceof Element && event.target.closest("a[href]")) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
    >
      <Excalidraw
        initialData={initial}
        excalidrawAPI={setApi}
        theme="light"
        name="Whiteboard"
        viewModeEnabled={locked}
        handleKeyboardGlobally={false}
        autoFocus
        aiEnabled={false}
        validateEmbeddable={false}
        onPaste={(data) =>
          !data.elements?.some(
            (element) => element.type === "embeddable" || element.type === "iframe",
          )
        }
        onLinkOpen={(_element, event) => event.preventDefault()}
        UIOptions={{
          canvasActions: {
            export: false,
            saveAsImage: false,
            loadScene: false,
            saveToActiveFile: false,
            toggleTheme: false,
            changeViewBackgroundColor: false,
          },
        }}
        onPointerDown={() => {
          pointer.current = true;
          current.current.onInteraction?.(true);
        }}
        onPointerUp={() => {
          pointer.current = false;
          // Final native onChange must reach the controller before idle rebasing.
          if (idleFrame.current !== null) cancelAnimationFrame(idleFrame.current);
          idleFrame.current = requestAnimationFrame(() => {
            idleFrame.current = null;
            const state = api?.getAppState();
            current.current.onInteraction?.(!!(state?.editingTextElement || state?.multiElement));
          });
        }}
        onChange={(elements, appState, files) => {
          if (applying.current) return;
          try {
            const next = asScene(elements, files);
            const fingerprint = sceneFingerprint(next);
            current.current.onError("");
            if (fingerprint !== baseline.current) {
              baseline.current = fingerprint;
              current.current.onChange(editorChanges(rawBase.current, editorBase.current, next));
            }
            current.current.onInteraction?.(
              pointer.current ||
                !!(
                  appState.editingTextElement ||
                  appState.multiElement ||
                  appState.newElement ||
                  appState.resizingElement
                ),
            );
          } catch {
            current.current.onError(
              "This drawing contains unsupported content or exceeds board limits. Remove it before saving. Links and embedded web pages are not supported.",
            );
          }
        }}
      >
        {/* An explicit empty screen replaces the vendor's default onboarding. */}
        <WelcomeScreen>
          <></>
        </WelcomeScreen>
        <MainMenu>
          <MainMenu.Item
            onSelect={() =>
              downloadScene(
                api
                  ? ({
                      elements: api.getSceneElementsIncludingDeleted(),
                      files: api.getFiles(),
                      background: "#ffffff",
                    } as unknown as BoardScene)
                  : current.current.scene,
              )
            }
          >
            Download my drawing
          </MainMenu.Item>
          <MainMenu.DefaultItems.ClearCanvas />
        </MainMenu>
      </Excalidraw>
    </div>
  );
}
