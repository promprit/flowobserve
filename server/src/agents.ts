import { DONE_DROP_MS } from "@fo/shared";
import type { AgentIdent, AgentLedger, AgentOutcome, AgentRec, AgentType, Event, SessionState } from "@fo/shared";
import { isExecutor } from "./ingest";

export const DISPATCH_TTL_MS = 60_000;
export const STALE_MS = 10 * 60_000;
export const MAX_DEPTH = 2;

export const blankLedger = (): AgentLedger =>
  ({ list: [], pending: [], tally: { spawned: 0, passed: 0, failed: 0, escalated: 0 }, escNext: null, binds: {}, outcome: {} });

export function agentType(subType: string, interrogate: boolean): AgentType {
  const s = subType.toLowerCase();
  if (isExecutor(s)) return interrogate ? "interrogate" : "executor";
  if (s.includes("review")) return "reviewer";
  const base = s.split(":").pop() ?? s;
  if (base === "explore" || /(?:investigator|researcher|explorer)$/.test(base)) return "explore";
  if (base === "plan" || /(?:planner|architect)$/.test(base)) return "plan";
  if (base === "" || base === "general-purpose" || base === "claude" || base === "fork") return "general";
  return "other";
}

const live = (l: AgentLedger, id: string | null) => (id ? l.list.find((a) => a.id === id && a.endedAt === null) : undefined);

/** 1 = spawned by the main session. */
function depth(l: AgentLedger, id: string): number {
  let d = 0;
  for (let cur = l.list.find((a) => a.id === id); cur && d <= MAX_DEPTH; cur = cur.parentId ? l.list.find((a) => a.id === cur!.parentId) : undefined) d++;
  return d;
}

/** The dispatching agent, or its parent when the child would sit deeper than MAX_DEPTH. */
function parentFor(l: AgentLedger, parent: string | null, child: string): string | null {
  const p = parent ? l.list.find((a) => a.id === parent) : undefined;
  if (!p) return null;
  const r = depth(l, p.id) >= MAX_DEPTH ? p.parentId : p.id;
  return r === child ? null : r;
}

const identOf = (a: AgentRec): AgentIdent =>
  ({ type: a.type, model: a.model, task: a.task, parentId: a.parentId, useId: a.useId ?? null, escalatedFrom: a.escalatedFrom, ...(a.disp ? { disp: a.disp } : {}) });

/** Outcome entries of old saves are the bare result string. */
const outcomeOf = (l: AgentLedger, id: string): AgentOutcome | undefined => {
  const o = l.outcome?.[id];
  return typeof o === "string" ? { result: o, ident: undefined } : o;
};

/** Takes `a` out of the list, remembering who it was so a resume can restore it. */
function drop(l: AgentLedger, a: AgentRec): void {
  const o = outcomeOf(l, a.id);
  (l.outcome ??= {})[a.id] = { result: o?.result ?? (a.state === "done" ? "done" : "failed"), ident: identOf(a) };
}

function end(l: AgentLedger, a: AgentRec, state: "done" | "failed", ts: number): void {
  (l.outcome ??= {})[a.id] = { result: state };
  a.endedAt = ts;
  a.state = state;
  a.running = null;
  if (state === "done") l.tally.passed++;
  else l.tally.failed++;
}

/** Moves a reopened agent's recorded outcome out of the tally. */
function undoOutcome(l: AgentLedger, id: string): void {
  const o = outcomeOf(l, id)?.result;
  if (o === "done") l.tally.passed--;
  else if (o === "failed") l.tally.failed--;
  if (l.outcome) delete l.outcome[id];
}

/** Re-pairs agent `a` with the dispatch carrying `useId`; keeps tally.escalated equal to the agents that carry escalatedFrom. */
function bind(l: AgentLedger, a: AgentRec, useId: string): void {
  if (a.useId === useId) return;
  const b = l.list.find((x) => x !== a && x.useId === useId);
  if (b) {
    const pick = (r: AgentRec) => ({ type: r.type, model: r.model, task: r.task, parentId: r.parentId, escalatedFrom: r.escalatedFrom, useId: r.useId, disp: r.disp });
    const pa = pick(a);
    Object.assign(a, pick(b));
    Object.assign(b, pa);
    if (a.parentId === a.id) a.parentId = null;
    if (b.parentId === b.id) b.parentId = null;
    return;
  }
  const i = l.pending.findIndex((p) => p.useId === useId);
  if (i < 0) return;
  const p = l.pending.splice(i, 1)[0];
  if (a.useId) l.pending.push({
    subType: a.disp?.subType ?? p.subType, type: a.type, model: a.model, task: a.task, parent: a.parentId, at: a.disp?.at ?? p.at, escalatedFrom: a.escalatedFrom, useId: a.useId,
  });
  l.tally.escalated += (p.escalatedFrom ? 1 : 0) - (a.escalatedFrom ? 1 : 0);
  Object.assign(a, { type: p.type, model: p.model, task: p.task, parentId: parentFor(l, p.parent, a.id), escalatedFrom: p.escalatedFrom, useId: p.useId, disp: { subType: p.subType, at: p.at } });
}

/** Advances the cycle's ledger after reduce's own apply. Pure; mutates the clone `s` it is given. */
export function stepAgents(prev: SessionState, s: SessionState, e: Event): void {
  if (!s.agents || s.cycleStart !== prev.cycleStart) s.agents = blankLedger();
  const l = s.agents, ts = e.ts;
  l.binds ??= {}; l.outcome ??= {};
  for (const k of Object.keys(l.binds)) if (ts - l.binds[k].at > DISPATCH_TTL_MS) delete l.binds[k];
  if (l.escNext?.at !== undefined && ts - l.escNext.at > STALE_MS) l.escNext = null;
  l.pending = l.pending.filter((p) => ts - p.at <= DISPATCH_TTL_MS);
  l.list = l.list.filter((a) => {
    const gone = a.state === "done" && a.endedAt !== null && ts - a.endedAt > DONE_DROP_MS;
    if (gone) drop(l, a);
    return !gone;
  });
  if (s.stage !== prev.stage || e.k === "End") {
    const stageStart = prev.stageAt[prev.stage] ?? 0;
    l.list = l.list.filter((a) => {
      const gone = a.endedAt !== null && a.state !== "done" && a.endedAt < stageStart;
      if (gone) drop(l, a);
      return !gone;
    });
    for (const a of l.list) if (a.endedAt === null && a.running === null && a.state !== "waiting" && ts - a.lastAt >= STALE_MS) end(l, a, "failed", ts);
  }
  switch (e.k) {
    case "AgentDispatch": {
      const esc = l.escNext && isExecutor(e.subType) && e.model === l.escNext.to ? l.escNext : null;
      if (esc) l.escNext = null;
      l.pending.push({
        subType: e.subType, type: agentType(e.subType, s.reviewersDue > 0), model: e.model,
        task: e.task ?? (esc?.task ? esc.task.slice(0, 160) : null), parent: e.agentId, at: ts,
        escalatedFrom: esc && esc.from !== "fable" ? esc.from : null, useId: e.useId,
      });
      break;
    }
    case "AgentBind": {
      const a = l.list.find((x) => x.id === e.subId);
      if (a) bind(l, a, e.useId);
      else l.binds[e.subId] = { useId: e.useId, at: ts };
      break;
    }
    case "SubStart": {
      const old = l.list.find((a) => a.id === e.subId);
      const sub = e.agentType ?? (e.executor ? "executor" : "");
      if (old || l.outcome[e.subId]) {
        const id = outcomeOf(l, e.subId)?.ident;
        undoOutcome(l, e.subId);
        if (old) { old.endedAt = null; old.state = "working"; old.running = null; old.lastAt = ts; }
        else l.list.push({
          id: e.subId, type: id?.type ?? agentType(sub, false), model: id?.model ?? null, parentId: id && id.parentId !== e.subId ? id.parentId : null,
          spawnedAt: ts, endedAt: null, state: "working", task: id?.task ?? null,
          running: null, toolCalls: 0, escalatedFrom: id?.escalatedFrom ?? null, lastAt: ts, useId: id?.useId ?? null, ...(id?.disp ? { disp: id.disp } : {}),
        });
        break;
      }
      const bound = l.binds[e.subId]?.useId;
      delete l.binds[e.subId];
      let i = bound ? l.pending.findIndex((p) => p.useId === bound) : -1;
      if (i < 0) i = l.pending.findIndex((p) => p.subType === sub);
      const p = i >= 0 ? l.pending.splice(i, 1)[0] : null;
      l.list.push({
        id: e.subId, type: p?.type ?? agentType(sub, false), model: p?.model ?? null, parentId: parentFor(l, p?.parent ?? null, e.subId),
        spawnedAt: ts, endedAt: null, state: "spawning", task: p?.task ?? null, running: null, toolCalls: 0,
        escalatedFrom: p?.escalatedFrom ?? null, lastAt: ts, useId: p?.useId ?? null, ...(p ? { disp: { subType: p.subType, at: p.at } } : {}),
      });
      l.tally.spawned++;
      if (p?.escalatedFrom) l.tally.escalated++;
      break;
    }
    case "ToolPre": {
      const a = live(l, e.agentId);
      if (a) { a.running = { tool: e.tool, since: ts }; a.state = "working"; a.lastAt = ts; }
      break;
    }
    case "ToolPost": {
      const a = live(l, e.agentId);
      if (a) { a.running = null; a.toolCalls++; a.state = "working"; a.lastAt = ts; }
      break;
    }
    case "Await": {
      const a = live(l, e.agentId);
      if (a && e.why === "notification") { a.state = "waiting"; a.lastAt = ts; }
      break;
    }
    case "JevDeny": {
      const lp = prev.lastPre;
      const a = lp && lp.agentId && lp.tool === e.tool && Math.abs(lp.ts - ts) <= 2000 ? live(l, lp.agentId) : undefined;
      if (a) a.state = "blocked";
      break;
    }
    case "Prompt":
      for (const a of l.list) if (a.endedAt === null && (a.state === "blocked" || a.state === "waiting")) a.state = "working";
      break;
    case "SubDone": {
      const a = live(l, e.subId);
      if (a) end(l, a, e.ok === false ? "failed" : "done", ts);
      break;
    }
    case "Escalation": {
      if (e.skip) break; // skipping a rung is not a climb
      const ex = l.list.filter((a) => a.type === "executor" && a.model === e.from && a.endedAt !== null && a.state !== "escalated");
      const latest = (xs: AgentRec[]) => xs.reduce<AgentRec | undefined>((m, a) => (!m || a.endedAt! >= m.endedAt! ? a : m), undefined);
      const match = ex.filter((a) => e.task && a.task === e.task), failed = ex.filter((a) => a.state === "failed");
      const run = latest(match.filter((a) => a.state === "failed")) ?? latest(match) ?? latest(failed) ?? latest(ex);
      if (run) {
        if (run.state === "done") { l.tally.passed--; l.tally.failed++; l.outcome[run.id] = { result: "failed" }; }
        run.state = "escalated";
      }
      if (e.from === "haiku" && !run) break;
      l.escNext = { from: e.from, to: e.to, task: e.task, at: ts };
      break;
    }
  }
}
