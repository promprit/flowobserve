/** Agents view model (spec 2026-10-08 agents view, PWA): wire agents → lineages, order, counts and text parts.
 *  Pure: no DOM, and no markup anywhere — every text helper returns plain strings or Part runs. */
import type { WireAgent, WireAgentTally } from "@fo/shared";
import { HEX } from "./config";
import { pad } from "./util";

export const AFADE = 20_000, AMAX = 16, ADEPTH = 2, MAXL = 8, SEL_MS = 60_000, FRESH_MS = 2500;
export type AType = WireAgent["type"];
export type AState = WireAgent["state"];
export type AModel = NonNullable<WireAgent["model"]>;
export type Cluster = "build" | "review" | "plan";
/** One run of text. `color` is always a value from HEX / MHEX, never from the wire. */
export interface Part { text: string; color?: string; bold?: boolean }
export interface Lineage { id: string; chain: WireAgent[]; head: WireAgent; parent: Lineage | null; kids: Lineage[]; depth: number; cluster: Cluster; name: string; vis: boolean }
export interface Counts { n: number; spawning: number; working: number; waiting: number; done: number; failed: number; blocked: number }
export interface AgentView { lineages: Lineage[]; order: Lineage[]; byId: Map<string, Lineage>; counts: Counts; tally: WireAgentTally }

export const TYPEW: Record<AType, string> = { executor: "EXECUTOR", reviewer: "REVIEWER", explore: "EXPLORE", plan: "PLANNER", general: "GENERAL", interrogate: "INTERROGATE", other: "AGENT" };
const CLUSTER: Partial<Record<AType, Cluster>> = { reviewer: "review", interrogate: "review", explore: "plan", plan: "plan" };
export const AWORD: Record<AState, string> = { spawning: "SPAWNING", working: "WORKING", waiting: "NEEDS YOU", done: "DONE", failed: "FAILED", blocked: "BLOCKED", escalated: "RE-DISPATCHING" };
export const MODELW: Record<AModel, string> = { haiku: "HAIKU", sonnet: "SONNET", opus: "OPUS", fable: "FABLE" };
export const MHEX: Record<AModel, string> = { haiku: HEX.haiku, sonnet: HEX.sonnet, opus: HEX.opus, fable: HEX.fable };
const TYPES = new Set<string>(Object.keys(TYPEW)), STATES = new Set<string>(Object.keys(AWORD)), MODELS = new Set<string>(Object.keys(MODELW));
const HOT = new Set<AState>(["failed", "blocked", "escalated"]);

export const modelHex = (m: AModel | null): string => (m ? MHEX[m] : HEX.paper);
/** Waiting, failed, blocked and escalated agents keep their own label and colour their status text. */
export const needsLook = (st: AState): boolean => st === "waiting" || HOT.has(st);
/** Orb / pip colour: amber only for waiting, red for failed|blocked|escalated, else the model colour. */
export const agentHex = (h: WireAgent): string => (h.state === "waiting" ? HEX.jev : HOT.has(h.state) ? HEX.deny : modelHex(h.model));
const wordHex = (h: WireAgent): string => (h.state === "waiting" ? HEX.jev : HOT.has(h.state) ? HEX.deny : h.state === "done" ? HEX.t3 : HEX.paper);
export const kfmt = (n: number): string => (n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + "K" : String(n | 0));
export const mmss = (ms: number): string => { const s = Math.max(0, (ms / 1000) | 0); return `${(s / 60) | 0}:${pad(s % 60)}`; };
const int = (x: unknown): number => Math.max(0, Number(x) | 0);
const num = (x: unknown): number => (Number.isFinite(Number(x)) ? Number(x) : 0);
const str = (x: unknown, max: number): string | null => (typeof x === "string" && x ? x.slice(0, max) : null);
const tool = (t: string): string => t.toUpperCase();
const mword = (m: AModel | null): string => (m ? MODELW[m] : "AGENT");

/** Wire agent → a safe copy: enums from fixed sets, numbers coerced, strings capped. Everything below reads only cleaned agents. */
export function clean(a: WireAgent): WireAgent {
  const r = a.running && typeof a.running === "object" ? { tool: str(a.running.tool, 64) ?? "TOOL", since: num(a.running.since) } : null;
  const ef = a.escalatedFrom;
  return {
    id: String(a.id ?? "").slice(0, 64), type: TYPES.has(a.type) ? a.type : "other", model: MODELS.has(a.model as string) ? a.model : null,
    parentId: str(a.parentId, 64), spawnedAt: num(a.spawnedAt), endedAt: a.endedAt == null ? null : num(a.endedAt),
    state: STATES.has(a.state) ? a.state : "working", task: str(a.task, 160), running: r, toolCalls: int(a.toolCalls), tokens: int(a.tokens),
    escalatedFrom: ef === "haiku" || ef === "sonnet" || ef === "opus" ? ef : null,
    taskId: str(a.taskId, 96), role: a.role === "tester" || a.role === "coder" || a.role === "reviewer" || a.role === "docs" ? a.role : null,
  };
}

export function countOf(ls: Lineage[]): Counts {
  const c: Counts = { n: ls.length, spawning: 0, working: 0, waiting: 0, done: 0, failed: 0, blocked: 0 };
  for (const L of ls) { const st = L.head.state === "escalated" ? "spawning" : L.head.state; c[st]++; }
  return c;
}

/** Spec Architecture: lineages (escalation joins), cycle-safe parents, depth ≤ 2, clusters, names, visibility, DFS order. */
export function agentView(s: { agents?: WireAgent[] | null; agentTally?: WireAgentTally | null }, now: number): AgentView | null {
  if (!s || !Array.isArray(s.agents)) return null;
  const all = s.agents.map(clean).filter((a) => a.id && a.spawnedAt <= now).sort((a, b) => a.spawnedAt - b.spawnedAt);
  const lines: Lineage[] = [], of = new Map<string, Lineage>();
  for (const a of all) {
    const J = a.escalatedFrom ? lines.find((l) => l.head.state === "escalated" && l.head.model === a.escalatedFrom && l.head.type === a.type && l.head.parentId === a.parentId) : undefined;
    if (J) { J.chain.push(a); J.head = a; of.set(a.id, J); continue; }
    const L: Lineage = { id: a.id, chain: [a], head: a, parent: null, kids: [], depth: 0, cluster: "build", name: "", vis: true };
    lines.push(L); of.set(a.id, L);
  }
  for (const L of lines) { const p = L.chain[0].parentId, P = p ? of.get(p) : undefined; L.parent = P && P !== L ? P : null; }
  for (const L of lines) { // cycle-safe: a parent chain that comes back on itself makes this lineage top-level
    const seen = new Set<Lineage>([L]);
    for (let p = L.parent; p; p = p.parent) { if (seen.has(p)) { L.parent = null; break; } seen.add(p); }
  }
  for (const L of lines) {
    let d = 0, top = L;
    while (top.parent) { top = top.parent; d++; }
    L.depth = Math.min(d, ADEPTH); L.cluster = CLUSTER[top.head.type] ?? "build";
  }
  const tot = new Map<AType, number>(), cnt = new Map<AType, number>();
  for (const L of lines) tot.set(L.chain[0].type, (tot.get(L.chain[0].type) ?? 0) + 1);
  for (const L of lines) {
    const ty = L.chain[0].type, c = (cnt.get(ty) ?? 0) + 1; cnt.set(ty, c);
    L.name = TYPEW[ty] + ((tot.get(ty) ?? 0) > 1 ? ` ${c}` : "");
  }
  for (const L of lines) L.vis = !(L.head.state === "done" && L.head.endedAt !== null && now - L.head.endedAt > AFADE);
  for (const L of lines) if (L.vis) for (let p = L.parent; p; p = p.parent) p.vis = true;
  for (const L of lines) if (L.parent) L.parent.kids.push(L);
  const order: Lineage[] = [], walk = (L: Lineage) => { if (!L.vis) return; order.push(L); L.kids.forEach(walk); };
  lines.filter((L) => !L.parent).forEach(walk);
  const byId = new Map<string, Lineage>();
  for (const L of lines) for (const a of L.chain) byId.set(a.id, L);
  const t = s.agentTally;
  const tally: WireAgentTally = t ? { spawned: int(t.spawned), passed: int(t.passed), failed: int(t.failed), escalated: int(t.escalated) }
    : { spawned: all.length, passed: all.filter((a) => a.state === "done").length, failed: all.filter((a) => HOT.has(a.state)).length, escalated: all.filter((a) => a.escalatedFrom).length };
  return { lineages: lines, order, byId, counts: countOf(order), tally };
}

/** The models this lineage ran on, oldest first. A re-dispatch whose failed run was cut still shows the model it came from (the pill). */
export function pillModels(L: Lineage): (AModel | null)[] {
  const ef = L.chain[0].escalatedFrom;
  return [...(ef ? [ef] : []), ...L.chain.map((a) => a.model)];
}

export function actLine(L: Lineage, now: number): string {
  const h = L.head, run = h.running ? `${tool(h.running.tool)} ${mmss(now - h.running.since)}` : "", pm = pillModels(L);
  const chain = pm.length > 1 ? pm.map(mword).join(" → ") + " · " : "";
  if (h.state === "working") return chain + (run || "WORKING");
  if (h.state === "waiting") return "NEEDS YOU" + (h.running ? " · " + tool(h.running.tool) : "");
  if (h.state === "failed") return h.model ? `FAILED · ${MODELW[h.model]}` : "FAILED";
  return AWORD[h.state];
}

const SEP: Part = { text: " · " };
const join = (groups: Part[][]): Part[] => groups.filter((g) => g.length).flatMap((g, i) => (i ? [SEP, ...g] : g));
export const partsText = (p: Part[]): string => p.map((x) => x.text).join("");

export function countParts(c: Counts): Part[] {
  return join([
    c.waiting ? [{ text: `${c.waiting} WAITING`, color: HEX.jev, bold: true }] : [],
    c.working ? [{ text: `${c.working} WORKING` }] : [],
    c.spawning ? [{ text: `${c.spawning} SPAWNING` }] : [],
    c.failed ? [{ text: `${c.failed} FAILED`, color: HEX.deny, bold: true }] : [],
    c.blocked ? [{ text: `${c.blocked} BLOCKED`, color: HEX.deny, bold: true }] : [],
    c.done ? [{ text: `${c.done} DONE`, color: HEX.t3 }] : [],
  ]);
}

export function summaryParts(v: AgentView, now: number): Part[] {
  if (!v.counts.n) return [];
  if (v.counts.n === 1) return [{ text: "1 AGENT", bold: true }, SEP, { text: actLine(v.order[0], now) }];
  return join([[{ text: `${v.counts.n} AGENTS`, bold: true }], countParts(v.counts)]);
}

export function tallyParts(t: WireAgentTally): Part[] {
  return join([[{ text: "THIS CYCLE" }], [{ text: `${t.spawned} SPAWNED` }], [{ text: `${t.passed} PASSED` }],
    [t.failed ? { text: `${t.failed} FAILED`, color: HEX.deny, bold: true } : { text: "0 FAILED" }], [{ text: `${t.escalated} ESCALATED` }]]);
}

export interface Detail { name: Part; word: Part; task: string; cells: { v: string; k: string; color?: string }[]; chain: Part[]; by: string }
export function detailRows(L: Lineage, now: number): Detail {
  const h = L.head, pm = pillModels(L), ef = pm.length - L.chain.length, kids = L.kids.length;
  const chain: Part[] = pm.length > 1 ? pm.flatMap((m, j) => {
    const a = j >= ef ? L.chain[j - ef] : null, last = j === pm.length - 1;
    const seg: Part = { text: mword(m) + (!last || a?.state === "failed" ? " ✗" : a?.state === "done" ? " ✓" : ""), color: modelHex(m) };
    return j ? [{ text: " → ", color: HEX.t3 }, seg] : [seg];
  }) : [];
  return {
    name: { text: `${L.name} · ${h.model ? MODELW[h.model] : "NO MODEL"}`, color: modelHex(h.model) },
    word: { text: AWORD[h.state], color: wordHex(h) },
    task: h.task || "No task line",
    cells: [
      { v: h.running ? `${tool(h.running.tool)} ${mmss(now - h.running.since)}` : "—", k: h.state === "waiting" ? "WAITING ON" : "TOOL NOW", color: h.state === "waiting" ? HEX.jev : HEX.paper },
      { v: mmss((h.endedAt ?? now) - h.spawnedAt), k: "ELAPSED" },
      { v: String(h.toolCalls), k: "TOOL CALLS" },
      { v: kfmt(h.tokens), k: "TOKENS" },
    ],
    chain,
    by: `SPAWNED BY ${L.parent ? L.parent.name : "MAIN SESSION"}${kids ? ` · ${kids} SUBAGENT${kids > 1 ? "S" : ""}` : ""}`,
  };
}

/** What the scene draws of a session's agents, as one string: a change wakes the renderer. Time alone never changes it. */
export const agentSig = (v: AgentView | null): string =>
  v ? v.order.map((L) => `${L.id}:${L.head.id}:${L.head.state}:${L.head.toolCalls}:${L.head.model ?? ""}`).join(",") : "";
