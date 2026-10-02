import { readFile, readdir } from "node:fs/promises";
import { expect, it } from "vitest";
import { localFontFallback, localExcalidrawFonts } from "../../tools/local-excalidraw-fonts.js";

it.each(["dev", "prod"])(
  "removes the pinned Excalidraw %s CDN fallback without changing font descriptors",
  async (mode) => {
    const directory = `node_modules/@excalidraw/excalidraw/dist/${mode}`;
    const files = (await readdir(directory)).filter((name) => name.endsWith(".js"));
    const sources = await Promise.all(
      files.map(async (name) => ({ name, code: await readFile(`${directory}/${name}`, "utf8") })),
    );
    const declarations = sources.filter((source) => source.code.includes('"ASSETS_FALLBACK_URL"'));
    expect(declarations).toHaveLength(1);
    const { name, code } = declarations[0];
    const transformed = localExcalidrawFonts().transform(
      code,
      `/project/${directory}/${name}`,
    )!.code;
    expect(transformed).toContain('new URL("/excalidraw/", window.location.origin).href');
    expect(transformed).not.toContain("https://esm.sh/");
    expect(transformed.match(/\.woff2/g)?.length).toBe(code.match(/\.woff2/g)?.length);
  },
);

it("fails closed when the vendor declaration changes and leaves unrelated modules alone", () => {
  expect(() => localFontFallback("changed vendor source")).toThrow("fallback changed");
  expect(localExcalidrawFonts().transform("unrelated", "/src/app.ts")).toBeUndefined();
});
