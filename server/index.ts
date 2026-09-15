import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { HerdrClient } from "./herdr/HerdrClient.js";
import { HerdrService } from "./herdr/herdrService.js";
import { createHttpServer } from "./http/server.js";

const projectRoot = resolve(process.cwd());
const socketPath = process.env.HERDR_SOCKET_PATH ?? join(homedir(), ".config/herdr/herdr.sock");
const host = process.env.HOST ?? "127.0.0.1";
const port = Number.parseInt(process.env.PORT ?? "8787", 10);

const client = new HerdrClient(socketPath);
const service = new HerdrService(client);
const server = createHttpServer(service, join(projectRoot, "dist"));

server.listen(port, host, () => {
  process.stdout.write(`Fernblick listening on http://${host}:${port}\n`);
});
