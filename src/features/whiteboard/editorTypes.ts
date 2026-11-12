import type { BoardScene } from "../../../packages/pi-live-chat/boardProtocol";

export interface EditorHandle {
  fit: () => void;
}
export interface BoardEditorProps {
  scene: BoardScene;
  generation: number;
  locked: boolean;
  onChange: (scene: BoardScene) => void;
  onReady: (handle: EditorHandle | null) => void;
  onError: (message: string) => void;
  onInteraction?: (active: boolean) => void;
  /** Persist a recovery copy before an explicit destructive import/clear. */
  onBeforeReplace?: () => Promise<void>;
  onDownload?: (anchor: HTMLElement) => void;
  downloadMenuOpen?: boolean;
  /** Shared whiteboard header slot; undefined retains a standalone editor header. */
  headerActions?: HTMLElement | null;
}
