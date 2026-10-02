import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": {
        target: process.env.FERNBLICK_API_TARGET ?? "http://127.0.0.1:8787",
        // Preserve the browser-facing host for the API's same-origin guard.
        changeOrigin: false,
      },
    },
  },
});
