import type { BoardScene } from "../../../packages/pi-live-chat/boardProtocol";

export function downloadScene(scene: BoardScene) {
  const blob = new Blob([JSON.stringify({ format: "fernblick-flow", version: 1, scene })], {
    type: "application/json",
  });
  downloadBlob(blob, "whiteboard.flow.json");
}
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
