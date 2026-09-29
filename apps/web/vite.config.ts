import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "./src") },
  },
  server: {
    port: 5173,
    // In dev, forward API calls to `wrangler dev` so cookies stay same-origin.
    proxy: {
      "/api": { target: "http://localhost:8787", changeOrigin: false },
    },
  },
  build: { outDir: "dist", emptyOutDir: true, sourcemap: true },
});
