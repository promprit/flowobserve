import { rmSync } from "node:fs";
import { join } from "node:path";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";

const API = "http://127.0.0.1:4317";
const proxy = { target: API, changeOrigin: true, headers: { origin: API } };

/** Demo build for dryasstudio.com/demos/flowobserve/: no PWA install surface, not indexed. */
function demoPage(): Plugin {
  let outDir = "dist-demo";
  return {
    name: "fo-demo-page",
    apply: "build",
    configResolved(c) { outDir = c.build.outDir; },
    transformIndexHtml(html) {
      return html
        .replace(/\s*<link rel="manifest"[^>]*>/, "")
        .replace("</title>", '</title>\n<meta name="robots" content="noindex">');
    },
    closeBundle() {
      for (const f of ["sw.js", "manifest.webmanifest"]) rmSync(join(outDir, f), { force: true });
    },
  };
}

export default defineConfig(({ mode }) => ({
  base: mode === "demo" ? "/demos/flowobserve/" : "/",
  plugins: mode === "demo" ? [demoPage()] : [],
  build: { outDir: "dist", emptyOutDir: true, target: "es2022", chunkSizeWarningLimit: 1500 },
  server: { host: "127.0.0.1", proxy: { "/ws": { ...proxy, ws: true }, "/events": proxy, "/spend": proxy, "/health": proxy } },
  test: { environment: "jsdom", include: ["test/**/*.test.ts"] },
}));
