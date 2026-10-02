export class BoardError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: "board_stale",
  ) {
    super(message);
    this.name = "BoardError";
  }
}

export function requireBoard(
  condition: unknown,
  status: number,
  message: string,
): asserts condition {
  if (!condition) throw new BoardError(status, message);
}
