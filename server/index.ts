import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { HerdrClient } from "./herdr/HerdrClient.js";
import { HerdrService } from "./herdr/herdrService.js";
import { createHttpServer } from "./http/server.js";
import { LiveBridge } from "./pi/liveBridge.js";
import { BoardStore } from "./boards/storage.js";
import { BoardRenderer } from "./boards/renderer.js";
import { SessionCatalog } from "./pi/sessionCatalog.js";
import { ChatArtifacts } from "./pi/chatArtifacts.js";
import { socketPath } from "../packages/pi-live-chat/security.js";

const projectRoot = resolve(process.cwd());
const herdrSocket = process.env.HERDR_SOCKET_PATH ?? join(homedir(), ".config/herdr/herdr.sock");
const host = process.env.HOST ?? "127.0.0.1";
const port = Number.parseInt(process.env.PORT ?? "8787", 10);
const bridge = new LiveBridge(socketPath(), herdrSocket);
await bridge.start();
const boards = new BoardStore(
  process.env.FERNBLICK_BOARD_DIR ?? join(homedir(), ".local/share/fernblick/boards"),
);
const service = new HerdrService(
  new HerdrClient(herdrSocket),
  new SessionCatalog(),
  new ChatArtifacts(boards, herdrSocket),
);
const server = createHttpServer(service, join(projectRoot, "dist"), bridge, boards, {
  directory:
    process.env.FERNBLICK_READ_RECEIPT_DIR ??
    join(homedir(), ".local/share/fernblick/read-receipts"),
  herdrSocket,
});
let renderer: BoardRenderer | undefined;
server.on("close", () => {
  boards.close();
  void bridge.close();
  void renderer?.close();
});
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.once(signal, () => {
    boards.close();
    server.close();
    server.closeAllConnections();
    void Promise.allSettled([bridge.close(), renderer?.close()]).finally(() => process.exit(0));
  });
server.listen(port, host, () => {
  const address = server.address();
  const renderHost = host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;
  const hostname = renderHost.includes(":") ? `[${renderHost}]` : renderHost;
  renderer = new BoardRenderer(
    process.env.FERNBLICK_RENDER_ORIGIN ??
      `http://${hostname}:${typeof address === "object" && address ? address.port : port}`,
  );
  bridge.setBoardRenderer((scene) => renderer!.render(scene));
  process.stdout.write(`Fernblick listening on http://${host}:${port}\n`);
});
