import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import { localExcalidrawFonts } from "./tools/local-excalidraw-fonts.js";
import { buildInfoPlugin } from "./tools/build-info.js";

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    buildInfoPlugin(),
    localExcalidrawFonts(),
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src/pwa",
      filename: "sw.ts",
      injectRegister: false,
      registerType: "prompt",
      // Only shipped frontend assets, never API responses or user uploads.
      injectManifest: {
        globPatterns: ["index.html", "assets/**/*.{js,css,woff2}", "icons/*.{png,svg}"],
        maximumFileSizeToCacheInBytes: 2 * 1024 * 1024,
      },
      manifest: {
        id: "/",
        name: "Fernblick",
        short_name: "Fernblick",
        description: "Keep your Herdr agents in view.",
        start_url: "/",
        scope: "/",
        display: "standalone",
        background_color: "#e7f2fc",
        theme_color: "#e7f2fc",
        icons: [
          { src: "/icons/scout-icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/scout-icon-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "/icons/scout-maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
    }),
  ],
  build: {
    rolldownOptions: { input: { app: "index.html", whiteboardRender: "whiteboard-render.html" } },
  },
  optimizeDeps: { rolldownOptions: { plugins: [localExcalidrawFonts()] } },
  server: {
    strictPort: true,
    proxy: {
      "/api": {
        target: process.env.FERNBLICK_API_TARGET ?? "http://127.0.0.1:8787",
        // Preserve the browser Host so the backend's Origin check remains valid.
        changeOrigin: false,
      },
    },
  },
});
