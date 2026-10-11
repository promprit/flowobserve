import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Edition } from "@fo/shared";
import { parseDisks, type DiskSpec } from "./hostparse";

// Timing (ms)
export const IDLE_MS = 600_000;
export const SHIPPED_HOLD_MS = 600_000;
export const FIVE_HOUR_MS = 18_000_000;
export const DAY_MS = 86_400_000;
export const TICK_MS = 30_000;
export const POLL_MS = 500;
export const USAGE_PUSH_MS = 5_000;
export const HB_MS = 5_000;
export const REGISTRY_MS = 2_000;
export const REGISTRY_GRACE_MS = 10_000;
export const CARD_TTL_MS = 86_400_000;

// Escalation ladder (mirrors ~/.claude/jev/thresholds.json escalation.*)
export const SONNET_FAILS = 2;
export const OPUS_FAILS = 1;

// Spend
export const JEV_BUDGET_USD = 5;
export const JEV_MODEL = "jev-1.13";

export const SPOOL_RETENTION_DAYS = 14;

export interface Config { home: string; spoolDir: string; jevLogDir: string; dbPath: string; port: number; staticDir: string; usageCachePath: string; disks: DiskSpec[]; transcriptsRoot: string; handoffDir: string; thresholdsPath: string; projectsRoot: string | null; helperJson: string; sessionsDir: string; edition: Edition }

const EDITIONS = ["vscode", "iterm", "both"] as const;

export function loadConfig(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): Config {
  const home = env.FO_HOME || path.join(os.homedir(), ".flowobserve");
  const here = path.dirname(fileURLToPath(import.meta.url));
  return {
    home,
    spoolDir: path.join(home, "spool"),
    jevLogDir: env.FO_JEV_LOGS || path.join(os.homedir(), ".claude", "jev", "logs"),
    dbPath: path.join(home, "fo.db"),
    port: Number(env.FO_PORT || 4317),
    staticDir: env.FO_STATIC || path.resolve(here, "../../pwa/dist"),
    usageCachePath: env.FO_USAGE_CACHE || path.join(os.homedir(), ".claude", "usage-cache.json"),
    disks: parseDisks(env.FO_DISKS),
    transcriptsRoot: env.FO_TRANSCRIPTS || path.join(os.homedir(), ".claude", "projects"),
    handoffDir: env.JEV_HANDOFF_DIR || path.join(os.homedir(), ".claude", "jev", "handoff"),
    thresholdsPath: env.FO_THRESHOLDS || path.join(os.homedir(), ".claude", "jev", "thresholds.json"),
    projectsRoot: env.FO_PROJECTS_ROOT || null,
    helperJson: path.join(home, "helper.json"),
    sessionsDir: env.FO_SESSIONS_DIR || path.join(os.homedir(), ".claude", "sessions"),
    // Windows has no iTerm2 or helper: VS Code only, whatever FO_EDITION says.
    edition: platform === "win32" ? "vscode" : (EDITIONS as readonly string[]).includes(env.FO_EDITION ?? "") ? env.FO_EDITION as Edition : "both",
  };
}

// Dryas KPIs, pinned to dryas-workflow docs/metrics.md@8cd1ad3 (change both together).
export const KPI_SOURCE = "dryas metrics.md@8cd1ad3";
export const KPI_EXE_M2_MIN_USD = 1;
export const KPI_FETCH_MS = 30 * DAY_MS;
export interface KpiDef {
  tile: "build" | "judge" | "escalate" | "review" | "usage" | "you"; unit: "pct" | "count" | "rounds" | "usd" | "ms";
  window: "7d" | "30d"; min: number | null; max: number | null; minN: number; healthy: string;
  nextHigh: string | null; nextLow: string | null;
}
export const KPIS = {
  "ESC-M1": { tile: "build", unit: "pct", window: "7d", min: null, max: 0.2, minN: 5, healthy: "<20%", nextHigh: "read escalation reasons; split plan tasks smaller", nextLow: null },
  "GOV-M2": { tile: "judge", unit: "pct", window: "7d", min: 0.05, max: 0.25, minN: 20, healthy: "5–25%", nextHigh: "/tune: raise dispatch.min_confidence", nextLow: "/tune: lower dispatch.min_confidence" },
  "ESC-M2": { tile: "escalate", unit: "count", window: "7d", min: null, max: 0, minN: 0, healthy: "0", nextHigh: "compliance: Fable dispatched before Opus failed", nextLow: null },
  "REV-M1": { tile: "review", unit: "rounds", window: "30d", min: null, max: 1, minN: 5, healthy: "≤1", nextHigh: "tighten the task's done criteria in the plan", nextLow: null },
  "EXE-M2": { tile: "usage", unit: "pct", window: "7d", min: null, max: 0.05, minN: 1, healthy: "<5%", nextHigh: "judge asked too often; check judged share in /tune", nextLow: null },
  "EXE-M3": { tile: "usage", unit: "usd", window: "30d", min: null, max: null, minN: 1, healthy: "trend", nextHigh: null, nextLow: null },
  "FO-GATE": { tile: "you", unit: "ms", window: "7d", min: null, max: 1_800_000, minN: 3, healthy: "< 30 min", nextHigh: "read specs and plans sooner; turn on push notifications", nextLow: null },
  "FO-SHIP": { tile: "you", unit: "ms", window: "7d", min: null, max: 7_200_000, minN: 3, healthy: "< 2 h", nextHigh: "finished work waits untested; use Try it", nextLow: null },
  "FO-TRY": { tile: "you", unit: "pct", window: "30d", min: null, max: 0.3, minN: 3, healthy: "< 30%", nextHigh: "reviews miss problems; tighten done criteria", nextLow: null },
} as const satisfies Record<string, KpiDef>;
