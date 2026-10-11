import { defineConfig } from "vitest/config";

const API = "http://127.0.0.1:4317";
const proxy = { target: API, changeOrigin: true, headers: { origin: API } };

export default defineConfig({
  build: { outDir: "dist", emptyOutDir: true, target: "es2022", chunkSizeWarningLimit: 1500 },
  server: { host: "127.0.0.1", proxy: { "/ws": { ...proxy, ws: true }, "/events": proxy, "/spend": proxy, "/health": proxy } },
  test: { environment: "jsdom", include: ["test/**/*.test.ts"] },
});
