import type { BoardScene } from "../packages/pi-live-chat/boardProtocol";
import type { BinaryFiles } from "@excalidraw/excalidraw/types";

const MAX_PNG_BYTES = 2 * 1024 * 1024;
const MAX_PIXELS = 2 * 1024 * 1024;

// Must precede the first runtime Excalidraw import, just like the editor.
(window as Window & { EXCALIDRAW_ASSET_PATH?: string }).EXCALIDRAW_ASSET_PATH = "/excalidraw/";

async function renderBoardScene(scene: BoardScene): Promise<string> {
  const { exportToBlob, restoreElements } = await import("@excalidraw/excalidraw");
  // Native restoration retains frames, bindings, freehand pressures, image crop,
  // rotation and all other supported native element properties.
  const elements = restoreElements(
    scene.elements as unknown as Parameters<typeof restoreElements>[0],
    null,
  ).filter((element) => !element.isDeleted);
  // Fail rather than silently export native broken-image placeholders. Decoded
  // raster dimensions are also bounded, independently of compressed input bytes.
  const usedFiles = new Set(
    elements.flatMap((element) =>
      element.type === "image" && element.fileId ? [element.fileId] : [],
    ),
  );
  let decodedPixels = 0;
  for (const id of usedFiles) {
    const file = scene.files[id];
    if (!file || !/^data:image\/(?:png|jpeg|gif|webp);base64,/.test(file.dataURL))
      throw new Error("Invalid board raster asset");
    const image = new Image();
    image.src = file.dataURL;
    await image.decode();
    decodedPixels += image.naturalWidth * image.naturalHeight;
    if (!image.naturalWidth || !image.naturalHeight || decodedPixels > 32 * 1024 * 1024)
      throw new Error("Board raster assets exceed the decoded pixel limit");
  }
  for (const maxSide of [2048, 1448, 1024, 724, 512]) {
    const blob = await exportToBlob({
      elements,
      files: scene.files as BinaryFiles,
      mimeType: "image/png",
      exportPadding: 20,
      appState: {
        viewBackgroundColor: scene.background,
        exportBackground: true,
        exportWithDarkMode: false,
        exportEmbedScene: false,
        exportScale: 1,
      },
      getDimensions(width: number, height: number) {
        if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0)
          throw new Error("Invalid board export bounds");
        const scale = Math.min(
          1,
          maxSide / width,
          maxSide / height,
          Math.sqrt(MAX_PIXELS / width / height),
        );
        return {
          width: Math.max(1, Math.floor(width * scale)),
          height: Math.max(1, Math.floor(height * scale)),
          scale,
        };
      },
    });
    if (Array.from(document.fonts).some((font) => font.status === "error"))
      throw new Error("Local whiteboard fonts could not load");
    if (blob.size > MAX_PNG_BYTES) continue;
    // FileReader avoids huge number arrays crossing the automation protocol.
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",")[1]);
      reader.onerror = () => reject(new Error("Could not encode board PNG"));
      reader.readAsDataURL(blob);
    });
  }
  throw new Error("Board PNG exceeds the output size limit");
}

(window as Window & { renderBoardScene?: typeof renderBoardScene }).renderBoardScene =
  renderBoardScene;
