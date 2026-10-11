/** Agents in the Loop (spec 2026-10-08 agents view PWA; prototype P:1193-1227, 1575-1590). Pure: layout, labels and slot binding;
 *  loop.ts draws. W space as the prototype: f = flow, h = height, s = spread (same transform as topology's W). */
import * as THREE from "three";
import { AMAX, FRESH_MS, actLine, agentHex, countOf, countParts, modelHex, needsLook, type AgentView, type AState, type Cluster, type Lineage, type Part } from "../agents";
import { HEX } from "../config";
import { laneTitle, type LaneView } from "../lanes";
import { clamp } from "../util";
import type { LaneObj } from "./lanes";
import { LANE_EDGE, laneSlots, type Topology } from "./topology";

export const BIRTH_GAP_MS = 90, EMERGE_MS = 900;
/** `key` is the lane key (task id) for an open lane's head, else the lineage id; `aid` is always the head lineage id (UI agent id). `lane` is bound by loop.ts. */
export interface AgentTarget { key: string; aid: string; par?: string; lane?: LaneObj; pa: THREE.Vector3; pb: THREE.Vector3; oa: THREE.Vector3; ob: THREE.Vector3; r: number; state: AState; col: string; tools: number; spawnedAt: number }
export interface AgentLabel { id: string; key: string; group: boolean; t1: string; t2: Part[]; c1: string; c2: string }

const WP = (P: boolean, f: number, h: number, s: number) => (P ? new THREE.Vector3(s * 1.1, -f * 0.85, h * 0.6) : new THREE.Vector3(f, h, s));
export const laneR = (n: number) => clamp(((2 * LANE_EDGE) / (n + 1)) * 0.28, 0.46, 0.9);
type Pos = { w: [number, number, number]; r: number; dir: [number, number]; o: string };

/** With open lanes, each lane's head sits on its lane node and other executors get no target; otherwise (and for general/other)
 *  agents fan from PLAN (1-3 keep the B1-B3 spacing, up to 16 shrink, >6 alternate the flow offset);
 *  reviewer/interrogate ring REVIEW and explore/plan ring PLAN (R = 3.6); children sit downstream at 0.68x on a tether to the parent. */
export function layoutAgents(v: AgentView, A: Topology, B: Topology, lv?: LaneView | null): AgentTarget[] {
  const pos = new Map<string, Pos>(), G0: Record<Cluster, Lineage[]> = { build: [], review: [], plan: [] };
  for (const L of v.order) if (!L.parent) G0[L.cluster].push(L);
  const lanes = lv && !lv.single ? lv.open : null, laneKey = new Map(lanes?.map((ln) => [ln.head.id, ln.key]) ?? []);
  if (lanes) {
    const n = lanes.length, SA = laneSlots(n, false), r = laneR(n);
    lanes.forEach((ln, i) => pos.set(ln.head.id, { w: [0, 3.4, SA.open[i].node.z], r, dir: [1, 0], o: "sq" }));
    G0.build = G0.build.filter((L) => L.chain[0].type !== "executor"); // executors not on an open lane get no target; general/other keep the PLAN fan
  }
  const nb = G0.build.length, half = nb <= 1 ? 0 : Math.min(9, (nb - 1) * 3.5), stp = nb > 1 ? (2 * half) / (nb - 1) : 0, rb = nb > 1 ? clamp(stp * 0.28, 0.46, 0.9) : 0.9;
  G0.build.forEach((L, i) => pos.set(L.id, { w: [nb > 6 ? (i % 2 ? 1 : -1) : 0, 3.4, -half + i * stp], r: rb, dir: [1, 0], o: "plan" }));
  for (const [key, cf] of [["review", 6], ["plan", -6]] as const) {
    const g = G0[key], n = g.length;
    g.forEach((L, i) => {
      const th = -Math.PI / 2 + (i * 2 * Math.PI) / Math.max(n, 2), R = 3.6;
      pos.set(L.id, { w: [cf + R * Math.cos(th), 4.2, R * Math.sin(th)], r: 0.62, dir: [Math.cos(th), Math.sin(th)], o: key });
    });
  }
  const place = (L: Lineage) => {
    const p = pos.get(L.id); if (!p) return;
    const ks = L.kids.filter((K) => K.vis);
    ks.forEach((K, j) => {
      const off = (j - (ks.length - 1) / 2) * 1.2, [df, ds] = p.dir;
      pos.set(K.id, { w: [p.w[0] + df * 1.9 - ds * off, p.w[1] - 0.3, p.w[2] + ds * 1.9 + df * off], r: p.r * 0.68, dir: p.dir, o: L.id });
      place(K);
    });
  };
  for (const L of v.order) if (!L.parent) place(L);
  const V3 = new Map<string, [THREE.Vector3, THREE.Vector3]>(), out: AgentTarget[] = [];
  for (const L of v.order) {
    const p = pos.get(L.id); if (!p) continue;
    const pa = WP(false, ...p.w), pb = WP(true, ...p.w), par = V3.get(p.o), node = p.o === "review" ? "review" : "plan", sq = p.o === "sq";
    V3.set(L.id, [pa, pb]);
    out.push({ key: laneKey.get(L.id) ?? L.id, aid: L.id, par: L.parent ? laneKey.get(L.parent.id) ?? L.parent.id : undefined, pa, pb, oa: par ? par[0] : A.N[sq ? "sq" : node].clone(), ob: par ? par[1] : B.N[sq ? "sq" : node].clone(), r: p.r,
      state: L.head.state, col: agentHex(L.head), tools: L.head.toolCalls, spawnedAt: L.chain[0].spawnedAt });
  }
  return out;
}

/** ≤3 agents in a cluster → one label each; more → one group label, plus a label for each agent that needs a look or is selected. */
export function agentLabels(v: AgentView, selAid: string | null, now: number, lv?: LaneView | null): AgentLabel[] {
  const laneBy = new Map(lv?.open.map((ln) => [ln.head.id, ln]) ?? []);
  const laneLines = new Set(lv && !lv.single ? lv.open.flatMap((ln) => ln.lines.map((l) => l.id)) : []);
  const hasOrb = (L: Lineage): boolean => L.parent ? hasOrb(L.parent) : !lv || lv.single || L.cluster !== "build" || laneBy.has(L.id) || (!laneLines.has(L.id) && L.chain[0].type !== "executor");
  const out: AgentLabel[] = [], by = new Map<Cluster, Lineage[]>();
  for (const L of v.order) { const g = by.get(L.cluster) ?? []; g.push(L); by.set(L.cluster, g); }
  for (const [cl, g] of by) {
    const group = g.filter(hasOrb).length > 3;
    if (group) out.push({ id: "agg:" + cl, key: (g.find((L) => !L.parent && hasOrb(L)) ?? g[0]).id, group: true, t1: `${g.filter(hasOrb).length} AGENTS`, t2: countParts(countOf(g)), c1: HEX.paper, c2: "" });
    for (const L of g) {
      const h = L.head, att = needsLook(h.state), sel = selAid === L.id;
      if (group && !att && !sel) continue;
      out.push({ id: "ag:" + L.id, key: L.id, group: false, t1: laneBy.has(L.id) ? laneTitle(laneBy.get(L.id)!) : L.name, t2: [{ text: actLine(L, now) }], c1: sel ? HEX.paper : modelHex(h.model), c2: att ? agentHex(h) : "" });
    }
  }
  return out;
}

export interface SlotTarget { key: string; aid?: string; tools: number; spawnedAt: number; state: AState }
export interface SlotState<T extends SlotTarget = SlotTarget> { key: string | null; T: T | null; live: boolean; born: number; tc: number; tick: number; init: boolean }

/** Binds this sync's targets to slots. A known key keeps its slot (no re-emerge on replay or focus switch); a new key takes a free slot,
 *  growing the pool on demand up to `max`. Fresh spawns are born ≥90 ms apart. Returns the new lastBorn and how long to keep rendering. */
export function bindSlots<T extends SlotTarget, S extends SlotState<T>>(slots: S[], targets: T[], wall: number, lastBorn: number, reduce: boolean, make: () => S, max = AMAX): { lastBorn: number; wakeMs: number } {
  let wakeMs = 0;
  for (const q of slots) q.live = false;
  for (const T of targets) {
    let q = slots.find((z) => z.key === T.key);
    if (!q) { // a late task tag changes an agent's key: the same agent keeps its orb
      q = slots.find((z) => z.key && z.T?.aid === T.aid && !targets.some((x) => x.key === z.key));
      if (q) q.key = T.key;
    }
    if (!q) {
      q = slots.find((z) => !z.key);
      if (!q && slots.length < max) { q = make(); slots.push(q); }
      if (!q) continue;
      const fresh = !reduce && wall - T.spawnedAt < FRESH_MS;
      q.key = T.key; q.born = fresh ? Math.max(wall, lastBorn + BIRTH_GAP_MS) : 0; q.tc = T.tools; q.tick = 0; q.init = true;
      if (fresh) { lastBorn = q.born; wakeMs = Math.max(wakeMs, q.born - wall + EMERGE_MS + 100); }
    } else if (q.T && T.aid !== q.T.aid) { // the lane's head changed (tester -> coder, a climb): same orb, one tick
      q.tc = T.tools;
      if (!reduce) { q.tick = 1; wakeMs = Math.max(wakeMs, 1000); }
    } else if (T.tools > q.tc) {
      q.tc = T.tools;
      if (T.state === "working" && !reduce) { q.tick = 1; wakeMs = Math.max(wakeMs, 1000); }
    }
    q.T = T; q.live = true;
  }
  return { lastBorn, wakeMs };
}
