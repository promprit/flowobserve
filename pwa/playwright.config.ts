import path from "node:path";
import { defineConfig } from "@playwright/test";
import { AG_HOME, AG_PORT, AG_TRANSCRIPTS, HOME, PORT, PROJECTS, V2_HOME, V2_PORT, V2_ROOT, V2_TRANSCRIPTS, VS_HOME, VS_PORT } from "./e2e/env";

export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  workers: 1,
  grepInvert: process.env.FO_VISUAL ? undefined : /@visual/,
  use: { baseURL: `http://127.0.0.1:${PORT}`, browserName: "chromium" },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 900 } } },
    { name: "tablet", use: { viewport: { width: 1024, height: 768 } } },
  ],
  webServer: [
    {
      command: "node --disable-warning=ExperimentalWarning ../server/dist/main.js",
      url: `http://127.0.0.1:${PORT}/health`,
      reuseExistingServer: false,
      env: { FO_HOME: HOME, FO_PORT: String(PORT), FO_STATIC: path.resolve("dist"), FO_JEV_LOGS: path.join(HOME, "jev"), FO_TRANSCRIPTS: PROJECTS },
    },
    {
      // v2 board: a projects root, a helper token and iTerm2 sessions (see env.ts).
      command: "node --disable-warning=ExperimentalWarning ../server/dist/main.js",
      url: `http://127.0.0.1:${V2_PORT}/health`,
      reuseExistingServer: false,
      env: { FO_HOME: V2_HOME, FO_PORT: String(V2_PORT), FO_STATIC: path.resolve("dist"), FO_JEV_LOGS: path.join(V2_HOME, "jev"), FO_TRANSCRIPTS: V2_TRANSCRIPTS, FO_PROJECTS_ROOT: V2_ROOT },
    },
    {
      // agents board (Phase 2): the agents spec appends hook lines to this server's spool.
      command: "node --disable-warning=ExperimentalWarning ../server/dist/main.js",
      url: `http://127.0.0.1:${AG_PORT}/health`,
      reuseExistingServer: false,
      env: { FO_HOME: AG_HOME, FO_PORT: String(AG_PORT), FO_STATIC: path.resolve("dist"), FO_JEV_LOGS: path.join(AG_HOME, "jev"), FO_TRANSCRIPTS: AG_TRANSCRIPTS },
    },
    {
      // VS Code edition board: v2's projects root with FO_EDITION=vscode.
      command: "node --disable-warning=ExperimentalWarning ../server/dist/main.js",
      url: `http://127.0.0.1:${VS_PORT}/health`,
      reuseExistingServer: false,
      env: { FO_HOME: VS_HOME, FO_PORT: String(VS_PORT), FO_STATIC: path.resolve("dist"), FO_JEV_LOGS: path.join(VS_HOME, "jev"), FO_TRANSCRIPTS: path.join(VS_HOME, "transcripts"), FO_PROJECTS_ROOT: V2_ROOT, FO_EDITION: "vscode" },
    },
  ],
});
