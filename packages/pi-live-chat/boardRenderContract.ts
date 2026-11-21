import type { BoardImageQuality } from "./boardImageExport.js";

// The isolated browser entry validates unknown input before rendering it.
declare global {
  interface Window {
    prepareFlowBoardScene: (
      scene: unknown,
      scale?: number,
      quality?: BoardImageQuality,
    ) => Promise<{ width: number; height: number }>;
  }
}
