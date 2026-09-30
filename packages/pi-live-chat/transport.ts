import type { Socket } from "node:net";
import { MAX_FRAME } from "./protocol.js";

// No unbounded line buffer, write queue, or awaited drain in a Pi handler.
export function receiveFrames(socket: Socket, receive: (value: unknown) => void) {
  let pending = Buffer.alloc(0);
  socket.on("data", (chunk: Buffer) => {
    let start = 0;
    for (let end = chunk.indexOf(10); end !== -1; end = chunk.indexOf(10, start)) {
      if (pending.length + end - start > MAX_FRAME) {
        socket.destroy();
        return;
      }
      const line = Buffer.concat([pending, chunk.subarray(start, end)]);
      pending = Buffer.alloc(0);
      try {
        receive(JSON.parse(line.toString("utf8")));
      } catch {
        socket.destroy();
        return;
      }
      if (socket.destroyed) return;
      start = end + 1;
    }
    if (pending.length + chunk.length - start > MAX_FRAME) {
      socket.destroy();
      return;
    }
    pending = Buffer.concat([pending, chunk.subarray(start)]);
  });
}
export function writeFrame(socket: Socket, value: unknown): boolean {
  if (socket.destroyed || !socket.writable) return false;
  const frame = JSON.stringify(value) + "\n";
  if (Buffer.byteLength(frame) + socket.writableLength > MAX_FRAME) {
    socket.destroy();
    return false;
  }
  socket.write(frame);
  return true;
}
