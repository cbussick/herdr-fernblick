// Excalidraw 0.18.1 always appends a CDN fallback, even with ASSET_PATH set.
// Keep that fallback same-origin too. Version/provenance is pinned by asset prep;
// fail loudly if the installed package changes this declaration.
export function localFontFallback(code: string): string {
  const declaration = /("ASSETS_FALLBACK_URL"\s*,\s*)`https:\/\/esm\.sh\/[\s\S]*?\/dist\/prod\/`/g;
  const matches = [...code.matchAll(declaration)];
  if (matches.length !== 1)
    throw new Error("Excalidraw font fallback changed; review the local font integration");
  return code.replace(declaration, '$1new URL("/excalidraw/", window.location.origin).href');
}

export function localExcalidrawFonts() {
  return {
    name: "fernblick-local-excalidraw-fonts",
    transform(code: string, id: string) {
      if (!id.includes("/@excalidraw/excalidraw/dist/") || !code.includes('"ASSETS_FALLBACK_URL"'))
        return;
      return { code: localFontFallback(code), map: null };
    },
  };
}
