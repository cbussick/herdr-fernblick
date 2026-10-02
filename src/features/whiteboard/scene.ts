import type { BoardScene } from "../../../packages/pi-live-chat/boardProtocol";

/** Excalidraw changes element versions for edits, not selection/pan/normalization. */
export function sceneFingerprint(scene: BoardScene) {
  return JSON.stringify([
    scene.elements.map((element) => [
      element.id,
      element.version,
      element.versionNonce,
      Boolean(element.isDeleted),
    ]),
    Object.entries(scene.files)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([id, file]) => [id, file.dataURL]),
    scene.background,
  ]);
}
export function downloadScene(scene: BoardScene) {
  const blob = new Blob(
    [
      JSON.stringify({
        type: "excalidraw",
        version: 2,
        source: "fernblick",
        elements: scene.elements,
        files: scene.files,
        appState: { viewBackgroundColor: scene.background },
      }),
    ],
    { type: "application/json" },
  );
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "whiteboard.excalidraw";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
