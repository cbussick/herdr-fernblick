import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { HerdrClient } from "./herdr/HerdrClient.js";
import { HerdrService } from "./herdr/herdrService.js";
import { createHttpServer } from "./http/server.js";
import { LiveBridge } from "./pi/liveBridge.js";
import { BoardStore } from "./boards/storage.js";
import { socketPath } from "../packages/pi-live-chat/security.js";

const projectRoot = resolve(process.cwd());
const herdrSocket = process.env.HERDR_SOCKET_PATH ?? join(homedir(), ".config/herdr/herdr.sock");
const host = process.env.HOST ?? "127.0.0.1";
const port = Number.parseInt(process.env.PORT ?? "8787", 10);
const service = new HerdrService(new HerdrClient(herdrSocket));
const bridge = new LiveBridge(socketPath(), herdrSocket);
await bridge.start();
const boards = new BoardStore(
  process.env.FERNBLICK_BOARD_DIR ?? join(homedir(), ".local/share/fernblick/boards"),
);
const server = createHttpServer(service, join(projectRoot, "dist"), bridge, boards);
server.on("close", () => {
  boards.close();
  void bridge.close();
});
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.once(signal, () => {
    boards.close();
    server.close();
    server.closeAllConnections();
    void bridge.close().finally(() => process.exit(0));
  });
server.listen(port, host, () => {
  process.stdout.write(`Fernblick listening on http://${host}:${port}\n`);
});
