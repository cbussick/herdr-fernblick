import { cp, mkdir, readFile, readdir } from "node:fs/promises";

const packageRoot = "node_modules/@excalidraw/excalidraw";
const pkg = JSON.parse(await readFile(`${packageRoot}/package.json`, "utf8"));
if (pkg.version !== "0.18.1")
  throw new Error("Review whiteboard font provenance before upgrading Excalidraw");
const source = `${packageRoot}/dist/prod/fonts`;
for (const family of await readdir(source)) {
  await readFile(`public/licenses/excalidraw/${family}.txt`, "utf8");
}
await mkdir("public/excalidraw", { recursive: true });
await cp(source, "public/excalidraw/fonts", { recursive: true, force: true });
console.log("Excalidraw fonts prepared for same-origin serving");
