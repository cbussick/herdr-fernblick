import { prepareFlowBoardScene } from "./features/flow/render";

declare global {
  interface Window {
    prepareFlowBoardScene: typeof prepareFlowBoardScene;
  }
}
window.prepareFlowBoardScene = prepareFlowBoardScene;
