import type { Event, ExecModel, GateKey, SessionState, Status } from "@fo/shared";
import { stepAgents } from "./agents";
import { DAY_MS, IDLE_MS, OPUS_FAILS, SHIPPED_HOLD_MS, SONNET_FAILS } from "./config";

export interface TransitionRow { sid: string; ts: number; fromStage: number; toStage: number; fromStatus: Status; toStatus: Status; cause: string }
export interface CallRow { ts: number; sid: string; role: "plan" | "build" | "judge" | "escalate" | "review" | "override" | "gate" | "ship" | "try"; model: string; ms: number | null; ok: boolean | null }
export interface CycleRow { sid: string; started: number; ended: number | null; lastStage: number; tasks: number; escalations: number; reviews?: number | null; planTasks?: number | null; outcome: "shipped" | "handoff" | "abandoned" | null }
export interface EscalationRow { ts: number; sid: string; task: string; from: ExecModel; to: ExecModel }
export interface SpendRow { ts: number; sid: string | null; project: string; model: string; source: "claude" | "jev"; usd: number }
export interface Emit { transitions: TransitionRow[]; calls: CallRow[]; cycles: CycleRow[]; spend: SpendRow[]; escalations: EscalationRow[] }

export const emptyEmit = (): Emit => ({ transitions: [], calls: [], cycles: [], spend: [], escalations: [] });

const WT_RE = /^(.*?)\/\.(?:claude\/)?worktrees\/([^/]+)(?:\/.*)?$/;

/** Pure path rule (no fs): `<project>/.claude/worktrees/<n>` or `<project>/.worktrees/<n>`. */
export function projectDirFromPath(cwd: string): string {
  const clean = cwd.replace(/\/+$/, "") || "/";
  return WT_RE.exec(clean)?.[1] ?? clean;
}
export function worktreeFromPath(cwd: string): string | null {
  const clean = cwd.replace(/\/+$/, "") || "/";
  return WT_RE.exec(clean)?.[2] ?? null;
}
export const projectDir = projectDirFromPath;

export function projectName(cwd: string): string {
  const dir = projectDirFromPath(cwd);
  return dir.split("/").filter(Boolean).pop() ?? dir;
}

const PLAN_SKILLS = new Set(["writing-plans", "wplan", "orchestrate"]);
const REVIEW_SKILLS = new Set(["wreview", "requesting-code-review", "code-review", "interrogate"]);
/** /interrogate dispatches exactly two read-only executor reviewers in one message. */
const INTERROGATE_PANEL = 2;
/** A log_review claims an unlogged skill-stop round only this soon after that stop. */
const CLAIM_MS = 15 * 60_000;
const BLANK_CYCLE = () => ({
  stage: 0, tasksDone: 0, tasksTotal: 0, builders: ["idle", "idle", "idle"] as SessionState["builders"],
  slots: {}, overflow: [], pendingModels: [], subModel: {}, subStartedAt: {},
  reviewersDue: 0, pendingReview: [] as boolean[], reviewSubs: {} as Record<string, true>,
  subQueue: [] as { id: string; model: ExecModel }[], pendingTags: [] as { task: string; role: string; tier: ExecModel }[], subTask: {} as Record<string, { task: string; role: string }>, doneTasks: [] as string[], untaggedDone: [] as string[],
  deny: null, waiting: null, esc: null, handoff: null, shippedAt: null,
  specThisCycle: false, planThisCycle: false, cycleHadHandoff: false, cycleEscalations: 0, cycleReviews: 0,
  planSkillAt: null, reviewSkillAt: null, judgeAt: null, reviewLogged: false, skillRoundUnlogged: null, reviewKeys: [] as string[],
  docs: { spec: 0, plan: 0, at: null as number | null },
  specPath: null as string | null, planPath: null as string | null, ready: null as SessionState["ready"], reviewDoneAt: null as number | null, ranAt: null as number | null, tryFound: false,
});
function tryRow(s: SessionState, ts: number, out: Emit): void {
  if (s.ranAt == null || s.stage >= 6) return;
  out.calls.push({ ts, sid: s.id, role: "try", model: "you", ms: null, ok: !s.tryFound });
}
export const blankStageAt = (start: number): (number | null)[] => [start, null, null, null, null, null, null];
/** Sessions saved before stageAt existed: cycle start, plus the current stage approximated by `since`. */
export function legacyStageAt(s: Pick<SessionState, "cycleStart" | "stage" | "since">): (number | null)[] {
  const a = blankStageAt(s.cycleStart);
  if (s.stage > 0) a[s.stage] = s.since;
  return a;
}

export function initState(sid: string, cwd: string, ts: number, where?: { project?: string; worktree?: string | null }): SessionState {
  const dir = where?.project ?? projectDirFromPath(cwd);
  return {
    id: sid, name: projectName(dir), cwd: dir, worktree: where?.worktree !== undefined ? where.worktree : worktreeFromPath(cwd), title: null, status: "active",
    ...BLANK_CYCLE(), cycleStart: ts, stageAt: blankStageAt(ts), lastPre: null, lastCostUsd: null, say: null, log: [],
    startedAt: ts, since: ts, lastEventAt: ts, retired: false,
    open: {}, wrote: null, fromClear: false, ctx: null, handoffAt: null,
    term: null, folderAbs: cwd, prompts: 0, lastEnd: null,
  };
}

export const openCycleRow = (s: SessionState): CycleRow =>
  ({ sid: s.id, started: s.cycleStart, ended: null, lastStage: 0, tasks: 0, escalations: 0, reviews: 0, planTasks: 0, outcome: null });

export function effectiveStatus(s: SessionState, now: number): Status {
  if (s.deny) return "deny";
  if (s.handoff) return "handoff";
  if (s.waiting) return "waiting";
  if (s.esc) return "escalated";
  if (s.shippedAt !== null) return now - s.shippedAt < SHIPPED_HOLD_MS ? "shipped" : "idle";
  return now - s.lastEventAt >= IDLE_MS ? "idle" : "active";
}

export const PASSIVE = new Set<Event["k"]>(["Usage", "Ctx", "Rc", "Handoff", "Helper", "BashResult", "JevAsk", "AgentBind"]);

export function reduce(prev: SessionState, e: Event): { state: SessionState; emit: Emit } {
  const s = structuredClone(prev);
  const out = emptyEmit();
  apply(s, e, effectiveStatus(prev, e.ts), out);
  if (e.title) s.title = e.title;
  if ((e.project ?? projectDirFromPath(e.cwd)) === s.cwd) s.worktree = e.worktree !== undefined ? e.worktree : worktreeFromPath(e.cwd);
  if (s.stageAt[s.stage] === null) s.stageAt[s.stage] = e.ts;
  stepAgents(prev, s, e);
  if (!PASSIVE.has(e.k)) s.lastEventAt = Math.max(s.lastEventAt, e.ts);
  if (e.k === "SessionSeen" && e.source === "startup") { if (prev.lastEventAt === prev.startedAt) s.spare = true; }
  else if (!PASSIVE.has(e.k)) delete s.spare;
  for (const [id, t] of Object.entries(s.open)) if (e.ts - t.since > DAY_MS) delete s.open[id];
  settle(prev, s, e.ts, cause(e), out);
  return { state: s, emit: out };
}

export function tick(prev: SessionState, now: number): { state: SessionState; emit: Emit } {
  const s = structuredClone(prev);
  const out = emptyEmit();
  settle(prev, s, now, "tick", out);
  return { state: s, emit: out };
}

function settle(prev: SessionState, s: SessionState, ts: number, why: string, out: Emit): void {
  const status = effectiveStatus(s, ts);
  if (status === prev.status && s.stage === prev.stage) return;
  out.transitions.push({ sid: s.id, ts, fromStage: prev.stage, toStage: s.stage, fromStatus: prev.status, toStatus: status, cause: why });
  if (status !== prev.status) s.since = ts;
  s.status = status;
}

function cause(e: Event): string {
  switch (e.k) {
    case "Skill": return `skill:${e.skill}`;
    case "Escalation": return `esc:${e.from}→${e.to}`;
    case "SubDone": return `sub:${e.subId}:${e.ok}`;
    case "Await": return `await:${e.why}`;
    default: return e.k;
  }
}

const advance = (s: SessionState, n: number) => { s.stage = Math.max(s.stage, n); };
const hasProgress = (s: SessionState) => s.stage > 0;

function cycleRow(s: SessionState, ended: number, outcome: CycleRow["outcome"]): CycleRow {
  return { sid: s.id, started: s.cycleStart, ended, lastStage: s.stage, tasks: s.tasksDone, escalations: s.cycleEscalations, reviews: s.cycleReviews ?? 0, planTasks: s.tasksTotal, outcome };
}

function newCycle(s: SessionState, ts: number, out: Emit): void {
  if (s.shippedAt === null) out.cycles.push(cycleRow(s, ts, s.cycleHadHandoff ? "handoff" : "abandoned"));
  Object.assign(s, BLANK_CYCLE(), { cycleStart: ts, stageAt: blankStageAt(ts) });
  out.cycles.push(openCycleRow(s));
}

function clearDeny(s: SessionState): void {
  const b = s.deny?.builder;
  if (b !== undefined && b !== null && s.builders[b] === "blocked") s.builders[b] = "working";
  s.deny = null;
}

function slotRow(s: SessionState, subId: string, slot: number, ts: number) {
  return { sid: s.id, ts, fromStage: s.stage, toStage: s.stage, fromStatus: s.status, toStatus: s.status, cause: `slot:${subId}→B${slot + 1}` };
}

function assignSlot(s: SessionState, subId: string, ts: number, out: Emit): void {
  const free = s.builders.findIndex((b) => b === "idle" || b === "done" || b === "failed");
  if (free < 0) { s.overflow.push(subId); return; }
  s.slots[subId] = free;
  s.builders[free] = "working";
  out.transitions.push(slotRow(s, subId, free, ts));
}

function creditTask(s: SessionState, tag: { task: string; role: string }): void {
  const d = (s.doneTasks ??= []);
  if (tag.role === "coder" && !d.includes(tag.task)) d.push(tag.task);
}
const syncTasksDone = (s: SessionState): void => { s.tasksDone = (s.doneTasks?.length ?? 0) + (s.untaggedDone?.length ?? 0); };

function subDone(s: SessionState, e: Extract<Event, { k: "SubDone" }>, out: Emit): void {
  for (const [id, t] of Object.entries(s.open)) if (t.agent === e.subId) delete s.open[id];
  const model = s.subModel[e.subId];
  if (!model) return;
  const ok = e.ok !== false;
  const started = s.subStartedAt[e.subId];
  delete s.subModel[e.subId];
  delete s.subStartedAt[e.subId];
  const slot = s.slots[e.subId];
  if (slot !== undefined) {
    delete s.slots[e.subId];
    s.builders[slot] = ok ? "done" : "failed";
    if (s.deny?.builder === slot) s.deny = null;
    const next = s.overflow.shift();
    if (next !== undefined) {
      s.slots[next] = slot;
      s.builders[slot] = "working";
      out.transitions.push(slotRow(s, next, slot, e.ts));
    }
  } else s.overflow = s.overflow.filter((x) => x !== e.subId);
  const ms = started === undefined ? null : e.ts - started;
  if (s.reviewSubs[e.subId]) {
    delete s.reviewSubs[e.subId];
    out.calls.push({ ts: e.ts, sid: s.id, role: "review", model, ms, ok: e.ok });
    return;
  }
  if (ok) {
    const tag = s.subTask?.[e.subId];
    if (tag) creditTask(s, tag);
    else (s.untaggedDone ??= []).push(e.subId);
    syncTasksDone(s);
  }
  out.calls.push({ ts: e.ts, sid: s.id, role: model === "sonnet" || model === "haiku" ? "build" : "escalate", model, ms, ok: e.ok });
  if (!s.esc || s.esc.subId !== e.subId) return;
  if (ok) {
    s.esc = null;
    if (s.stage === 4) s.stage = 3; // the one sanctioned step back: Escalate returns to Build
  } else if (model === "fable") {
    s.handoff = { builder: slot ?? null, reports: s.esc.failures + 1 };
    s.esc = null;
    s.cycleHadHandoff = true;
  } else {
    s.esc.failures += 1; // Opus failed; the Fable escalation comes next
    s.esc.subId = null;
  }
}

function escalate(s: SessionState, e: Extract<Event, { k: "Escalation" }>): void {
  if (e.from === "haiku") return; // Haiku to Sonnet is a rung of Build, not an escalation
  advance(s, 4);
  s.cycleEscalations++;
  if (!s.esc) {
    s.esc = { builder: null, subId: null, chain: [e.from, e.to], failures: e.from === "sonnet" ? SONNET_FAILS : SONNET_FAILS + OPUS_FAILS, task: e.task };
    return;
  }
  if (s.esc.chain[s.esc.chain.length - 1] !== e.to) s.esc.chain.push(e.to);
  s.esc.task = e.task || s.esc.task;
  s.esc.subId = null;
}

/** Which gate ring a Jev decision belongs to (spec §11): the builder whose last PreToolUse matches, else commit at Ship, else route. */
function gateOf(s: SessionState, tool: string, ts: number): { builder: number | null; gate: GateKey } {
  const lp = s.lastPre;
  const b = lp && lp.agentId && lp.tool === tool && Math.abs(lp.ts - ts) <= 2000 ? s.slots[lp.agentId] ?? null : null;
  return { builder: b, gate: b !== null ? (`d${b}` as GateKey) : s.stage === 6 ? "commit" : "route" };
}

function apply(s: SessionState, e: Event, before: Status, out: Emit): void {
  const main = e.agentId === null;
  switch (e.k) {
    case "Prompt":
      s.prompts = (s.prompts ?? 0) + 1;
      if (s.waiting && (s.wrote === "spec" || s.wrote === "plan") && s.docs?.at)
        out.calls.push({ ts: e.ts, sid: s.id, role: "gate", model: "you", ms: e.ts - s.docs.at, ok: true });
      if ((before === "shipped" || before === "idle") && hasProgress(s)) newCycle(s, e.ts, out);
      s.waiting = null;
      s.handoff = null;
      for (const [id, t] of Object.entries(s.open)) if (t.agent === null) delete s.open[id];
      s.wrote = null;
      s.fromClear = false;
      s.reviewersDue = 0; // the panel is dispatched in the same turn as the read
      s.startsDue = 0; // so is a skip-up's dispatch
      clearDeny(s);
      break;
    case "Skill": {
      const name = e.skill.split(":").pop() ?? e.skill;
      if (name === "brainstorming") { if (hasProgress(s)) newCycle(s, e.ts, out); }
      else if (PLAN_SKILLS.has(name)) { advance(s, 1); s.planSkillAt = e.ts; }
      else if (REVIEW_SKILLS.has(name)) {
        advance(s, 5);
        // Interrogate's reviewers log their own review calls; the orchestrator's stop must not add a third.
        if (name === "interrogate") s.reviewersDue = INTERROGATE_PANEL;
        else if (e.agentId === null) { s.reviewSkillAt = e.ts; s.reviewLogged = false; s.skillRoundUnlogged = null; }
      }
      else if (name === "commit") {
        // A commit before Build (spec or plan docs) is bookkeeping, not Ship; the ratchet would otherwise pin the cycle at Ship.
        if (s.stage < 3) break;
        tryRow(s, e.ts, out);
        advance(s, 6);
      }
      break;
    }
    case "PlanWritten":
      advance(s, 1);
      s.planThisCycle = true;
      s.docs = { spec: s.docs?.spec ?? 0, plan: (s.docs?.plan ?? 0) + 1, at: e.ts };
      s.wrote = "plan";
      s.planPath = e.path;
      if (e.tasks !== null) s.tasksTotal = e.tasks;
      out.calls.push({ ts: e.ts, sid: s.id, role: "plan", model: "opus", ms: s.planSkillAt === null ? null : e.ts - s.planSkillAt, ok: true });
      s.planSkillAt = null;
      break;
    case "SpecWritten":
      s.specThisCycle = true;
      s.docs = { spec: (s.docs?.spec ?? 0) + 1, plan: s.docs?.plan ?? 0, at: e.ts };
      s.wrote = "spec";
      s.specPath = e.path;
      break;
    case "JevJudge":
      if (e.phase === "pre") { advance(s, 2); s.judgeAt = e.ts; break; }
      out.calls.push({ ts: e.ts, sid: s.id, role: "judge", model: "jev", ms: s.judgeAt === null ? null : e.ts - s.judgeAt, ok: true });
      s.judgeAt = null;
      break;
    case "Dispatch": {
      // An interrogate reviewer on Opus is review, not a climb: it must not reach Escalate.
      const reviewer = s.reviewersDue > 0;
      const start = !reviewer && e.model === "opus" && (s.startsDue ?? 0) > 0;
      if (reviewer) s.reviewersDue--;
      else {
        if (start) s.startsDue!--;
        advance(s, start || e.model === "sonnet" || e.model === "haiku" ? 3 : 4);
      }
      if (s.ranAt != null) s.tryFound = true;
      s.pendingModels.push(e.model);
      s.pendingReview.push(reviewer);
      break;
    }
    case "SubStart": {
      if (!e.executor) break;
      const model: ExecModel = s.pendingModels.shift() ?? "sonnet";
      if (s.pendingReview.shift()) s.reviewSubs[e.subId] = true;
      const pi = (s.pendingTags ??= []).findIndex((p) => p.tier === model);
      if (pi >= 0) (s.subTask ??= {})[e.subId] = s.pendingTags.splice(pi, 1)[0];
      else (s.subQueue ??= []).push({ id: e.subId, model });
      s.subModel[e.subId] = model;
      s.subStartedAt[e.subId] = e.ts;
      assignSlot(s, e.subId, e.ts, out);
      if (s.esc && s.esc.subId === null && model === s.esc.chain[s.esc.chain.length - 1]) {
        s.esc.subId = e.subId;
        s.esc.builder = s.slots[e.subId] ?? null;
      }
      break;
    }
    case "SubDone":
      subDone(s, e, out);
      break;
    case "TaskDispatch": {
      const qi = (s.subQueue ??= []).findIndex((q) => q.model === e.tier);
      if (qi < 0) { (s.pendingTags ??= []).push({ task: e.task, role: e.role, tier: e.tier }); break; }
      const id = s.subQueue.splice(qi, 1)[0].id;
      const tag = { task: e.task, role: e.role };
      (s.subTask ??= {})[id] = tag;
      const u = (s.untaggedDone ??= []);
      const i = u.indexOf(id);
      if (i >= 0) { u.splice(i, 1); creditTask(s, tag); syncTasksDone(s); }
      break;
    }
    case "Escalation":
      // A skip-up is a start tier, not a climb: no stage or esc; an Opus start lets the next Opus dispatch stay in Build.
      if (e.skip) { if (e.to === "opus") s.startsDue = (s.startsDue ?? 0) + 1; }
      else escalate(s, e);
      out.escalations.push({ ts: e.ts, sid: s.id, task: e.task, from: e.from, to: e.to });
      break;
    case "JevDeny": {
      const { builder: b, gate } = gateOf(s, e.tool, e.ts);
      clearDeny(s);
      s.deny = { builder: b, command: e.command };
      if (b !== null) s.builders[b] = "blocked";
      s.gateFlash = { gate, kind: "deny", at: e.ts };
      break;
    }
    case "JevAsk":
      s.gateFlash = { gate: gateOf(s, e.tool, e.ts).gate, kind: "ask", at: e.ts };
      break;
    case "Await": {
      if (e.why === "stop" && main) {
        for (const [id, t] of Object.entries(s.open)) if (t.agent === null) delete s.open[id];
        s.reviewersDue = 0;
      }
      if (e.why === "stop" && main && s.reviewSkillAt !== null) {
        out.calls.push({ ts: e.ts, sid: s.id, role: "review", model: "opus", ms: e.ts - s.reviewSkillAt, ok: true });
        s.reviewSkillAt = null;
        if (!s.reviewLogged) { s.cycleReviews = (s.cycleReviews ?? 0) + 1; s.skillRoundUnlogged = e.ts; }
        s.reviewLogged = false;
        s.ready = { tests: null, build: null, ...s.ready, review: true };
        s.reviewDoneAt = e.ts;
        if (s.shippedAt !== null) out.cycles.push(cycleRow(s, s.shippedAt, "shipped"));
      }
      const passive = e.why === "stop" || e.why === "idle";
      if (passive && (s.shippedAt !== null || s.builders.includes("working"))) break;
      const kind = s.wrote === "spec" && s.stage === 0 ? "spec" : s.wrote === "plan" && s.stage === 1 ? "plan" : "answer";
      s.waiting = { kind, text: e.text || s.say?.text || "" };
      break;
    }
    case "ReviewLogged":
      advance(s, 5);
      if (e.round !== null) {
        const key = `${e.task ?? ""}#${e.round}`;
        s.reviewKeys ??= [];
        if (s.reviewKeys.includes(key)) break;
        s.reviewKeys.push(key);
      }
      if (s.reviewSkillAt !== null) { s.cycleReviews = (s.cycleReviews ?? 0) + 1; s.reviewLogged = true; }
      else if (s.skillRoundUnlogged != null && e.ts - s.skillRoundUnlogged <= CLAIM_MS) s.skillRoundUnlogged = null;
      else s.cycleReviews = (s.cycleReviews ?? 0) + 1;
      break;
    case "ToolPre":
      s.lastPre = { tool: e.tool, agentId: e.agentId, ts: e.ts };
      if (e.useId) s.open[e.useId] = { tool: e.tool, since: e.ts, agent: e.agentId };
      if (main && e.tool !== "AskUserQuestion") s.waiting = null;
      break;
    case "ToolPost":
      if (e.useId) delete s.open[e.useId];
      if (main) s.waiting = null;
      break;
    case "BashResult":
      s.ready = { tests: null, build: null, review: null, ...s.ready, [e.kind === "test" ? "tests" : "build"]: e.ok };
      if (e.kind === "test") {
        if (e.passed !== undefined && e.failed !== undefined) { s.ready.passed = e.passed; s.ready.failed = e.failed; }
        else { delete s.ready.passed; delete s.ready.failed; }
      }
      break;
    case "Helper":
      if (e.action === "run" && e.ok) {
        s.ranAt = e.ts;
        if (s.reviewDoneAt != null) out.calls.push({ ts: e.ts, sid: s.id, role: "ship", model: "you", ms: e.ts - s.reviewDoneAt, ok: true });
      }
      break;
    case "Merge":
      tryRow(s, e.ts, out);
      advance(s, 6);
      s.waiting = null;
      if (s.shippedAt === null) { s.shippedAt = e.ts; out.cycles.push(cycleRow(s, e.ts, "shipped")); }
      break;
    case "Say":
      s.say = { t: e.ts, text: e.text };
      if (s.log[s.log.length - 1]?.text !== e.text) s.log = [...s.log, { t: e.ts, text: e.text }].slice(-6);
      break;
    case "Usage":
      // Claude spend now comes from transcripts (spec §9.3); the statusline only feeds rate limits.
      break;
    case "End":
      s.lastEnd = e.reason ?? null;
      s.rc = null;
      s.retired = true;
      s.waiting = null;
      s.handoff = null;
      s.open = {};
      clearDeny(s);
      break;
    case "SessionSeen":
      if (e.term) s.term = e.term;
      s.folderAbs = e.cwd;
      if (e.source === "clear") s.fromClear = true;
      break;
    case "Rc":
      s.rc = e.takenOverAt === null ? null : { takenOverAt: e.takenOverAt };
      break;
    case "Ctx":
      s.ctx = e.ctx;
      break;
    case "Handoff":
      s.handoffAt = e.savedAt;
      break;
  }
}
