import type { NodeKey, Status, WireAgent } from "@fo/shared";
import type { Builder } from "../config";
import { clamp } from "../util";

/** Spec §5 motion tiers: motion tracks activity. Values are tuned live with the user (Task 14); Task 11 adds the rest of this file. */
export type Tier = "working" | "breathing" | "still";
export const LIFE: Record<Tier, { drift: number; pulse: number; sway: number; packets: boolean }> = {
  working: { drift: 1, pulse: 1, sway: 1, packets: true },
  breathing: { drift: 0.35, pulse: 0.4, sway: 0.5, packets: false },
  still: { drift: 0, pulse: 0, sway: 0, packets: false },
};

export const RATE_WIN_MS = 60_000, QUIET_MS = 60_000, STALL_MS = 120_000, ESC_MS = 1600;
const RATE_MIN = 2, RATE_MAX = 30;

/** lastEventAt advances per session over the last 60 s. The first sighting is a baseline, not an event. */
export class RateWindow {
  private m = new Map<string, { last: number; at: number[] }>();
  note(id: string, lastEventAt: number, now: number): void {
    const e = this.m.get(id);
    if (!e) { this.m.set(id, { last: lastEventAt, at: [] }); return; }
    if (lastEventAt > e.last) { e.last = lastEventAt; e.at.push(lastEventAt); }
    while (e.at.length && e.at[0] <= now - RATE_WIN_MS) e.at.shift();
  }
  rate(id: string, now: number): number {
    const e = this.m.get(id);
    return e ? e.at.filter((t) => t > now - RATE_WIN_MS).length : 0;
  }
  keep(ids: Iterable<string>): void {
    const k = new Set(ids);
    for (const id of [...this.m.keys()]) if (!k.has(id)) this.m.delete(id);
  }
}

/** Packet and edge-pulse speed: rate clamped to 2-30 events/min, mapped linearly to 0.5-1.5. */
export const speedOf = (rate: number): number => 0.5 + (clamp(rate, RATE_MIN, RATE_MAX) - RATE_MIN) / (RATE_MAX - RATE_MIN);

export interface Shape { stage: number; status: Status; builders: Builder[]; deny: number | null; esc: boolean; lastEventAt: number; running?: { tool: string; since: number } | null; agents?: WireAgent[] | null }
type Run = { tool: string; since: number };

/** The oldest open tool call: the main thread's, or (agents mode) a working agent's. A long tool is work, not a stall. */
export function oldestRun(s: Pick<Shape, "running" | "agents">): Run | null {
  let r: Run | null = s.running ?? null;
  for (const a of s.agents ?? []) if (a.state === "working" && a.running && (!r || a.running.since < r.since)) r = a.running;
  return r;
}
/** Is anyone building? Agents mode (agents present, even []) reads the agents, never builders[]. */
const busy = (s: Pick<Shape, "builders" | "agents">): boolean => (s.agents ? s.agents.some((a) => a.state === "working") : s.builders.includes("working"));
/** Agents mode: the oldest working agent's cluster root: REVIEW for reviewer/interrogate, else PLAN (where the fan starts). */
function agentNode(ag: WireAgent[]): NodeKey | null {
  let o: WireAgent | null = null;
  for (const a of ag) if (a.state === "working" && (!o || a.spawnedAt < o.spawnedAt)) o = a;
  return !o ? null : o.type === "reviewer" || o.type === "interrogate" ? "review" : "plan";
}

/** The node where work is happening: a stall dims it, a long tool labels it, reduced motion rings it. */
export function activeNode(s: Shape): NodeKey | null {
  if (s.status === "shipped") return "main";
  if (s.esc && (s.status === "escalated" || s.status === "handoff")) return "fable";
  if (s.status === "deny" && s.deny !== null) return s.agents ? "plan" : (`b${s.deny}` as NodeKey);
  if (s.status === "waiting" || s.stage === 0) return "you";
  if (s.stage <= 2) return "plan";
  if (s.agents && s.stage <= 5) return agentNode(s.agents) ?? (s.stage === 5 ? "review" : "plan");
  if (s.stage <= 4) { const i = s.builders.indexOf("working"); return i >= 0 ? (`b${i}` as NodeKey) : "plan"; }
  return s.stage === 5 ? "review" : "main";
}

/** Whole minutes without an event while someone works and no tool is open, once past 120 s; else 0. */
export function stallMin(s: Pick<Shape, "status" | "builders" | "lastEventAt" | "running" | "agents">, now: number): number {
  if (s.status === "shipped" || oldestRun(s) || !busy(s)) return 0;
  const gap = now - s.lastEventAt;
  return gap > STALL_MS ? Math.floor(gap / 60_000) : 0;
}

/** Whole minutes the oldest open tool has run, once past 120 s; else 0. */
export function runningMin(s: Pick<Shape, "running" | "agents">, now: number): number {
  const r = oldestRun(s), gap = r ? now - r.since : 0;
  return gap > STALL_MS ? Math.floor(gap / 60_000) : 0;
}

/** Spec section 5 tiers: motion tracks activity. */
export function tierOf(s: Shape, now: number): Tier {
  if (s.status === "idle") return "still";
  if (s.status === "waiting" || s.status === "deny" || s.status === "handoff" || s.status === "shipped") return "breathing";
  if (stallMin(s, now)) return "breathing";
  if (oldestRun(s) || busy(s) || now - s.lastEventAt < QUIET_MS) return "working";
  return "breathing";
}

const RANK: Record<Tier, number> = { still: 0, breathing: 1, working: 2 };
export const sceneTier = (tiers: Tier[]): Tier => tiers.reduce<Tier>((a, t) => (RANK[t] > RANK[a] ? t : a), "still");
