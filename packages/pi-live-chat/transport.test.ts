import { Socket } from "node:net";
import { expect, it, vi } from "vitest";
import { receiveFrames, writeFrame } from "./transport.js";
import { MAX_FRAME } from "./protocol.js";

function socket() {
  const s = new Socket();
  vi.spyOn(s, "write").mockReturnValue(true);
  vi.spyOn(s, "destroy");
  return { s, socket: s };
}
it("frames split UTF-8 and several messages without corrupting content", () => {
  const { s, socket: sock } = socket();
  const receive = vi.fn();
  receiveFrames(sock, receive);
  const data = Buffer.from('{"text":"€"}\n{"n":2}\n');
  s.emit("data", data.subarray(0, 11));
  s.emit("data", data.subarray(11));
  expect(receive.mock.calls).toEqual([[{ text: "€" }], [{ n: 2 }]]);
});
it("drops invalid JSON and oversized incomplete frames", () => {
  for (const data of [Buffer.from("not json\n"), Buffer.alloc(MAX_FRAME + 1, 97)]) {
    const { s, socket: sock } = socket();
    receiveFrames(sock, vi.fn());
    s.emit("data", data);
    expect(s.destroy).toHaveBeenCalled();
  }
});
it("never waits for drain and disconnects bounded slow readers", () => {
  const { s, socket: sock } = socket();
  vi.mocked(s.write).mockReturnValue(false);
  expect(writeFrame(sock, { text: "hello" })).toBe(true);
  vi.spyOn(s, "writableLength", "get").mockReturnValue(MAX_FRAME + 1);
  expect(writeFrame(sock, { text: "hello" })).toBe(false);
  expect(s.destroy).toHaveBeenCalled();
});
