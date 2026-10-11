/** Build lanes (spec 2026-10-09 loop build lanes): one lane per plan task, open ≤ LANE_MAX, done/queued as counts. Pure. */
import { MODELW, pillModels, type AgentView, type AModel, type Lineage } from "./agents";

export const LANE_MAX = 6;
export type LaneState = "working" | "waiting" | "failed" | "blocked" | "climbing" | "frontier" | "handoff";
export interface Lane { key: string; num: number | null; lines: Lineage[]; head: Lineage; rung: AModel | null; climbed: AModel[]; role: "tester" | "coder" | null; state: LaneState }
export interface LaneView { open: Lane[]; done: number; queued: number; overflow: number; single: boolean }

export const taskNum = (id: string): number | null => { const m = /(\d+)$/.exec(id); return m ? Number(m[1]) : null; };
const ROLEW = { tester: "TEST", coder: "CODE" } as const;
export const laneTitle = (L: Lane): string =>
  L.num === null ? L.head.name : [`T${L.num}`, ...(L.rung ? [MODELW[L.rung]] : []), ...(L.role ? [ROLEW[L.role]] : [])].join(" · ");

const PRI: Record<LaneState, number> = { waiting: 0, failed: 1, blocked: 1, frontier: 1, climbing: 2, working: 3, handoff: 4 };

export function laneView(s: { tasksTotal: number; tasksDone: number; esc?: boolean }, v: AgentView | null): LaneView {
  const by = new Map<string, Lineage[]>();
  for (const L of v?.lineages ?? []) {
    if (L.parent || L.cluster !== "build" || L.chain[0].type !== "executor") continue;
    const k = L.chain.find((a) => a.taskId)?.taskId ?? L.id;
    const g = by.get(k) ?? []; g.push(L); by.set(k, g);
  }
  // Once any task has a Fable lineage, s.esc is explained by that task; it must not light other tasks' lanes.
  const anyFable = [...by.values()].some((g) => g.some((L) => L.head.model === "fable"));
  const all: Lane[] = [];
  let doneN = 0;
  for (const [key, group] of by) {
    // Fable lineages belong to the Frontier node: they never form or head a lane, they only mark their task frontier.
    let fable = false, fableDone = false, fableBad: "failed" | "blocked" | null = null;
    const lines: Lineage[] = [];
    for (const L of group) {
      if (L.head.model !== "fable") { lines.push(L); continue; }
      if (L.head.state === "done") fableDone = true; else fable = true;
      if (L.head.state === "failed" || L.head.state === "blocked") fableBad = L.head.state;
      const i = L.chain.findLastIndex((a) => a.model !== "fable");
      if (i >= 0) lines.push({ ...L, chain: L.chain.slice(0, i + 1), head: L.chain[i] });
    }
    if (fableDone) { doneN++; continue; }
    if (!lines.length) continue;
    const tagged = group.some((L) => L.chain.some((a) => a.taskId));
    const head = lines[lines.length - 1], h = head.head, role = h.role === "tester" || h.role === "coder" ? h.role : null;
    // Climbed = escalation joins inside the head lineage only; tester/coder lineages on one task are not a climb.
    const climbed = pillModels(head).slice(0, -1).filter((m, i, a): m is AModel => !!m && m !== a[i - 1]); // the head's own model is the last element, null or not
    if (h.state === "done" && role !== "tester") { doneN++; continue; }
    const state: LaneState = fableBad ? fableBad : fable || (s.esc && !anyFable && h.model === "opus" && (h.state === "failed" || h.state === "escalated")) ? "frontier"
      : h.state === "done" ? "handoff"
      : h.state === "escalated" ? "climbing" : h.state === "waiting" || h.state === "failed" || h.state === "blocked" ? h.state : "working";
    all.push({ key, num: tagged ? taskNum(key) : null, lines, head, rung: h.model, climbed, role, state });
  }
  const ord = (a: Lane, b: Lane) => (a.num ?? Infinity) - (b.num ?? Infinity) || a.lines[0].chain[0].spawnedAt - b.lines[0].chain[0].spawnedAt;
  const keep = [...all].sort((a, b) => PRI[a.state] - PRI[b.state] || ord(a, b)).slice(0, LANE_MAX);
  const open = keep.sort(ord), overflow = all.length - open.length;
  const done = s.tasksTotal > 0 ? Math.max(s.tasksDone, doneN) : doneN;
  const queued = s.tasksTotal > 0 ? Math.max(0, s.tasksTotal - done - all.length) : 0;
  return { open, done, queued, overflow, single: s.tasksTotal === 0 && by.size === 0 };
}
