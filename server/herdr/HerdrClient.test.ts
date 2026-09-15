import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { HerdrClient, HerdrRequestError } from "./HerdrClient.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })));
});

async function createSocketServer(
  respond: (request: { id: string; method: string; params: Record<string, unknown> }) => string,
) {
  const directory = await mkdtemp(join(tmpdir(), "fernblick-"));
  temporaryDirectories.push(directory);
  const socketPath = join(directory, "herdr.sock");

  const server = net.createServer((socket) => {
    socket.setEncoding("utf8");
    socket.once("data", (data) => {
      const request = JSON.parse(String(data).trim()) as {
        id: string;
        method: string;
        params: Record<string, unknown>;
      };
      const response = respond(request);
      const splitAt = Math.floor(response.length / 2);
      socket.write(response.slice(0, splitAt));
      socket.end(`${response.slice(splitAt)}\n`);
    });
  });

  await new Promise<void>((resolve) => server.listen(socketPath, resolve));
  return { server, socketPath };
}

describe("HerdrClient", () => {
  it("sends newline-delimited requests and parses a fragmented response", async () => {
    const { server, socketPath } = await createSocketServer((request) =>
      JSON.stringify({ id: request.id, result: { type: "pong" } }),
    );

    const client = new HerdrClient(socketPath);
    await expect(
      client.request("ping", {}, z.object({ type: z.literal("pong") })),
    ).resolves.toEqual({
      type: "pong",
    });

    server.close();
  });

  it("returns Herdr error codes without exposing protocol details", async () => {
    const { server, socketPath } = await createSocketServer((request) =>
      JSON.stringify({
        id: request.id,
        error: { code: "agent_blocked", message: "agent needs input" },
      }),
    );

    const client = new HerdrClient(socketPath);
    const error = await client
      .request("agent.prompt", {}, z.unknown())
      .catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(HerdrRequestError);
    expect(error).toMatchObject({ code: "agent_blocked", message: "agent needs input" });

    server.close();
  });
});
