import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // In dev, forward API calls to `wrangler dev` so cookies stay same-origin.
    proxy: {
      "/api": { target: "http://localhost:8787", changeOrigin: false },
    },
  },
  build: { outDir: "dist", emptyOutDir: true, sourcemap: true },
});
