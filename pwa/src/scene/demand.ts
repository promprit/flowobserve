/** Render on demand (spec §6): the scene renders only while something moves. Pure; world.ts feeds it. */

import type { Tier } from "./rate";

/** After a state change, keep rendering this long so every eased value (trunk reveal is the slowest) settles. */
export const SETTLE_MS = 4000;
export const demand = { wakeUntil: 0, rendered: 0 };

export function wake(nowMs: number, ms = SETTLE_MS): void { demand.wakeUntil = Math.max(demand.wakeUntil, nowMs + ms); }

export interface Motion {
  now: number;        // performance.now()
  settling: boolean;  // portrait/landscape morph in progress
  camLag: number;     // distance between eased camera and its goal
  zoomGap: number;    // |view.zt - view.z|
  orbiting: boolean;  // drag or ease home in progress
  shipWave: boolean;  // ship celebration running
  tier: Tier;         // scene motion tier (spec §5)
  reduce: boolean;    // prefers-reduced-motion
  capped?: boolean;   // bloom is dead and frames are still over budget: working tier drops to 24 fps
}

/** User-driven or settling motion: these always render at full rate. */
const fast = (m: Motion, wakeUntil: number): boolean =>
  m.now < wakeUntil || m.settling || m.camLag > 0.02 || m.zoomGap > 0.002 || m.orbiting;

export function wantsFrame(m: Motion, wakeUntil = demand.wakeUntil): boolean {
  if (fast(m, wakeUntil)) return true;
  return !m.reduce && (m.shipWave || m.tier !== "still");
}

/** Spec §5 frame rate: working 30 fps, breathing 12 fps; camera, morph, ship wave and the settle window 60. */
export const FRAME_MS = { fast: 16, working: 33, capped: 41, breathing: 83, slack: 3 } as const;
export const minGapMs = (m: Motion, wakeUntil = demand.wakeUntil): number =>
  fast(m, wakeUntil) || m.shipWave ? FRAME_MS.fast : m.tier === "breathing" ? FRAME_MS.breathing : m.capped ? FRAME_MS.capped : FRAME_MS.working;
/** Render now? `sinceLastRender` is measured from the last rendered frame, not the last rAF. */
export const due = (m: Motion, sinceLastRender: number, wakeUntil = demand.wakeUntil): boolean =>
  sinceLastRender >= minGapMs(m, wakeUntil) - FRAME_MS.slack;
/** Seconds a rendered frame advances: the real gap, or one 60 fps step after a pause so eased values never jump. */
export const frameDt = (sinceLastRender: number): number => (sinceLastRender > 100 ? 1 / 60 : sinceLastRender / 1000);

export type SigRow = [id: string, stage: number, status: string, builders: string, deny: number | null, esc: boolean, seen: boolean, tasksDone: number, tasksTotal: number, stall: number, agents?: string];
/** Everything the scene draws from the store, as one string: a change means wake. Time alone never changes it. */
export const sceneSig = (rows: SigRow[], link: string, focus: string | null): string =>
  `${link}|${focus}|` + rows.map((r) => (r[10] === undefined ? r.slice(0, 10) : r).join(",")).join(";"); // no agents field: today's exact signature

/** Bloom gate (spec §2). gpuMs: measured GPU time vs budgetMs; undefined = timer works but nothing resolved this frame
 *  (no strike change); null = no timer, fall back to the rendered-frame gap scaled to the frame cap. gapMs 0 = uncounted. */
export const BLOOM = { budgetMs: 4, gapMs: 20, strikes: 3 } as const;
export interface BloomGate { over: number; dead: boolean }
export interface BloomSample { gpuMs: number | null | undefined; gapMs: number; capMs: number }
const isOver = (s: BloomSample): boolean =>
  s.gpuMs !== null ? s.gpuMs !== undefined && s.gpuMs > BLOOM.budgetMs : s.gapMs > 0 && s.gapMs > (BLOOM.gapMs * s.capMs) / 16;
export function bloomOn(g: BloomGate, attention: boolean, s: BloomSample): boolean {
  if (g.dead) return false;
  if (!attention) { g.over = 0; return false; }
  if (s.gpuMs === undefined) return true;
  const over = isOver(s);
  g.over = over ? g.over + 1 : 0;
  if (g.over >= BLOOM.strikes) { g.dead = true; return false; }
  return true;
}

/** 24 fps cap (spec §5): bloom already gave up and frames are still over budget, N strikes in a row -> capped for the page. */
export interface CapGate { over: number; capped: boolean }
export function capOn(g: CapGate, bloomDead: boolean, s: BloomSample): boolean {
  if (g.capped) return true;
  if (!bloomDead || s.gpuMs === undefined) { if (!bloomDead) g.over = 0; return false; }
  g.over = isOver(s) ? g.over + 1 : 0;
  if (g.over >= BLOOM.strikes) g.capped = true;
  return g.capped;
}
