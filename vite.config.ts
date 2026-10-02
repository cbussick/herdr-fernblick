import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8787",
        // Keep Host aligned with the browser Origin for the backend CSRF guard.
        // Vite\'s string shorthand enables changeOrigin and breaks valid sends.
        changeOrigin: false,
      },
    },
  },
});
