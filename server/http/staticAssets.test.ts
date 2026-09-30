import { mkdtemp, mkdir, copyFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { expect, test } from "vitest";
import { createHttpServer } from "./server.js";
import type { HerdrService } from "../herdr/herdrService.js";
import type { LiveBridge } from "../pi/liveBridge.js";

test("serves the locally hosted Manrope font and its complete OFL license", async () => {
  const directory = await mkdtemp(join(tmpdir(), "fernblick-static-"));
  const server = createHttpServer({} as HerdrService, directory, {} as LiveBridge);
  try {
    await mkdir(join(directory, "licenses"));
    await copyFile("public/licenses/Manrope-OFL.txt", join(directory, "licenses/Manrope-OFL.txt"));
    await copyFile(
      "src/styles/fonts/manrope-latin-wght-normal.woff2",
      join(directory, "manrope.woff2"),
    );
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve(undefined));
    });
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const license = await fetch(`${base}/licenses/Manrope-OFL.txt`);
    expect(license.status).toBe(200);
    expect(license.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(await license.text()).toBe(
      await readFile("src/styles/fonts/Manrope-LICENSE.txt", "utf8"),
    );
    const font = await fetch(`${base}/manrope.woff2`);
    expect(font.status).toBe(200);
    expect(font.headers.get("content-type")).toBe("font/woff2");
    expect(Buffer.from(await font.arrayBuffer())).toEqual(
      await readFile("src/styles/fonts/manrope-latin-wght-normal.woff2"),
    );
  } finally {
    if (server.listening)
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    await rm(directory, { recursive: true, force: true });
  }
});
