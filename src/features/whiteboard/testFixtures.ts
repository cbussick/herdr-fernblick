import type {
  BoardScene,
  BoardState,
  BoardTarget,
} from "../../../packages/pi-live-chat/boardProtocol";

export const target: BoardTarget = {
  runtime: "11111111-1111-4111-8111-111111111111",
  epoch: "22222222-2222-4222-8222-222222222222",
  sessionId: "session-a",
};
export function scene(version = 1): BoardScene {
  return {
    elements: [
      {
        id: "box",
        type: "rectangle",
        x: version * 10,
        y: 10,
        width: 100,
        height: 80,
        version,
        versionNonce: version,
        isDeleted: false,
      },
    ],
    files: {},
    background: "#ffffff",
  };
}
export function board(revision = 1): BoardState {
  return {
    id: "a".repeat(64),
    revision,
    scene: scene(revision),
    updatedAt: 1,
    lastAuthor: "human",
    snapshots: [],
    access: null,
  };
}
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
