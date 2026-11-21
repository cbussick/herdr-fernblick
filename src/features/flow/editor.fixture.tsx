import { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import FlowBoardEditor from "./FlowBoardEditor";
import type { BoardScene } from "../../../packages/pi-live-chat/boardProtocol";
import type { EditorHandle } from "../whiteboard/editorTypes";
const empty: BoardScene = { engine: "react-flow", elements: [], files: {}, background: "#ffffff" };
const test = {
  changes: [] as Array<BoardScene>,
  events: [] as Array<string>,
  errors: [] as Array<string>,
  ready: false,
  checkpointError: "",
  setScene: (_scene: BoardScene) => {},
  setLocked: (_locked: boolean) => {},
};
declare global {
  interface Window {
    flowTest: typeof test;
  }
}
window.flowTest = test;
export function Fixture() {
  const [scene, setScene] = useState(empty),
    [generation, setGeneration] = useState(0),
    [locked, setLocked] = useState(false);
  useEffect(() => {
    test.setScene = (next) => {
      setScene(next);
      setGeneration((value) => value + 1);
    };
    test.setLocked = setLocked;
    return () => {
      test.setScene = () => {};
      test.setLocked = () => {};
    };
  }, []);
  const ready = useCallback((handle: EditorHandle | null) => {
    test.ready = !!handle;
  }, []);
  return (
    <FlowBoardEditor
      scene={scene}
      generation={generation}
      locked={locked}
      onReady={ready}
      onBeforeReplace={async () => {
        test.events.push("checkpoint");
        if (test.checkpointError) {
          throw new Error(test.checkpointError);
        }
      }}
      onChange={(scene) => {
        test.events.push("change");
        test.changes.push(scene);
        setScene(scene);
      }}
      onError={(message) => {
        if (message) {
          test.errors.push(message);
        }
      }}
      onInteraction={(active) => test.events.push(active ? "active" : "idle")}
    />
  );
}
const root = document.getElementById("root");
if (!root) {
  throw new Error("Flow editor fixture root is missing");
}
createRoot(root).render(<Fixture />);
