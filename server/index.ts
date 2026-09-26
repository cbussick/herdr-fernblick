import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { HerdrClient } from "./herdr/HerdrClient.js";
import { HerdrService } from "./herdr/herdrService.js";
import { createHttpServer } from "./http/server.js";
import { QueueStore } from "./queue/queueStore.js";
import { QueueDispatcher } from "./queue/queueDispatcher.js";

const projectRoot = resolve(process.cwd());
const socketPath = process.env.HERDR_SOCKET_PATH ?? join(homedir(), ".config/herdr/herdr.sock");
const host = process.env.HOST ?? "127.0.0.1";
const port = Number.parseInt(process.env.PORT ?? "8787", 10);

const client = new HerdrClient(socketPath);
const service = new HerdrService(client);
const queue = new QueueStore();
const dispatcher = new QueueDispatcher(queue, service);
const server = createHttpServer(service, join(projectRoot, "dist"), queue);
const poll = () =>
  void dispatcher.tick().catch((error: unknown) => {
    console.error(
      "Fernblick queue polling failed",
      error instanceof Error ? error.name : "unknown",
    );
  });
const interval = setInterval(poll, 1000);
server.on("close", () => {
  clearInterval(interval);
  void dispatcher.stop().then(() => queue.close());
});
poll();

server.listen(port, host, () => {
  process.stdout.write(`Fernblick listening on http://${host}:${port}\n`);
});
