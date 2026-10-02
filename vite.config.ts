import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { localExcalidrawFonts } from "./tools/local-excalidraw-fonts.js";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), localExcalidrawFonts()],
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
