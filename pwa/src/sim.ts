import type { Host, Metrics, NodeKey, Usage, WireAgent, WireNode } from "@fo/shared";
import { I3, type Builder } from "./config";
import { pager, resetPager } from "./pager";
import { type CSession, changed, now, store, ui, view } from "./state";
import { say, setS } from "./store";
import { pct, quant } from "./util";
import { agentView, needsLook } from "./agents";

/** Per-session sim memory for node detail: when each builder started, and which builder is escalated on which task. */
const track = new WeakMap<CSession, { bAt: number[]; prev: Builder[]; esc: { i: number; task: string } | null }>();
const trk = (s: CSession) => { let k = track.get(s); if (!k) { k = { bAt: [0, 0, 0], prev: I3(), esc: null }; track.set(s, k); } return k; };
export function simEsc(s: CSession, i: number, task: string): void { trk(s).esc = { i, task }; }

/** Demo stand-in for the server's toNodes: derives nodes + stageAt from the simulated session. */
export function simNodes(s: CSession, t = now()): void {
  const k = trk(s);
  if (s.stage === 0 && s.stageAt.some((v, i) => i > 0 && v !== null)) s.stageAt = [t, null, null, null, null, null, null];
  if (s.stageAt[s.stage] === null) s.stageAt[s.stage] = t;
  s.builders.forEach((b, i) => { if (b === "working" && k.prev[i] !== "working") k.bAt[i] = t; });
  k.prev = s.builders.slice();
  if (!s.esc) k.esc = null;
  const fable = s.esc && /Fable/.test(s.msg ?? "");
  const out: WireNode[] = [];
  const n = (key: NodeKey, state: WireNode["state"], o: Partial<WireNode> = {}) =>
    out.push({ key, state, model: null, startedAt: null, task: null, waiting: null, ...o });
  if (s.status === "waiting") n("you", "waiting", { startedAt: s.since, waiting: s.msg });
  if (s.stage === 1) n("plan", "current", { startedAt: s.stageAt[1] });
  s.builders.forEach((b, i) => {
    if (b === "idle") return;
    const e = k.esc && k.esc.i === i ? k.esc : null;
    n(`b${i}` as NodeKey, b, { model: e ? (fable ? "fable" : "opus") : "sonnet", startedAt: k.bAt[i] || null, task: e ? e.task : null });
  });
  if (s.stage === 5 || s.stage === 6) n(s.stage === 5 ? "review" : "main", "current", { startedAt: s.stageAt[s.stage] });
  if (fable) n("fable", "escalated", { model: "fable", startedAt: s.since, task: k.esc?.task ?? null });
  s.nodes = out;
}
const set = (s: CSession, patch: Partial<CSession>) => { setS(s, patch); simNodes(s); };
export function pauseSim(): void { sim.on = false; if (agentSim.tick) { clearInterval(agentSim.tick); agentSim.tick = null; } }

const NAMES = ["flowobserve", "atlas", "dryas", "harbor", "meadow", "ember", "jev"];
const CMDS = ["rm -rf ./migrations", "git push --force origin main", "curl … | sh", "chmod -R 777 .", "DROP TABLE users"];
const BRAIN = ["scope, offline behaviour and what “done” means", "two approaches; recommending the smaller one", "edge cases for empty and error states"];
const WORK = ["parse_date edge cases", "session store migration", "retry with backoff", "auth token refresh", "empty-state copy", "websocket reconnect", "CSV export"];
const SPEED = Number(new URLSearchParams(location.search).get("speed") || 1) || 1;
const R = (a: number, b: number) => ((a + Math.random() * (b - a)) * 1000) / SPEED;
const pick = <T>(a: readonly T[]): T => a[(Math.random() * a.length) | 0];
const lat = (a: number, b: number) => a + Math.random() * (b - a);

type Gen = Generator<number, void, unknown>;
type Tally = { role: string; model: string; calls: number; _lat: number[]; [k: string]: number | string | number[] };
let M: Record<"plan" | "build" | "judge" | "escalate" | "review", Tally>;
const n = (t: Tally, k: string) => (t[k] as number) || 0;
const inc = (t: Tally, k: string, d = 1) => { t[k] = n(t, k) + d; };

/** Tallies → wire Metrics (the prototype's renderModels sim branch, moved here). */
function publish(): void {
  const out = {} as Metrics;
  for (const k of ["plan", "build", "judge", "escalate", "review"] as const) {
    const m = M[k], l = m._lat;
    let signal: string, warn = false;
    if (k === "plan") signal = `plans approved first time ${Math.min(100, pct(n(m, "ok"), n(m, "asked")))}%`;
    else if (k === "build") { const r = pct(n(m, "pass"), m.calls); warn = r < 70; signal = `Build pass ${r}%${warn ? " · split plan tasks smaller" : ""}`; }
    else if (k === "judge") { const o = pct(n(m, "over"), n(m, "judged")); warn = o > 20; signal = `Judge overridden ${o}%${warn ? " · run /tune" : ""}`; }
    else if (k === "escalate") { const r = pct(n(m, "of"), n(m, "so")); warn = r > 10; signal = `Fable reached ${r}%${warn ? " · review failed tasks in the plan" : ""}`; }
    else signal = `spec + quality pass ${pct(n(m, "ok"), m.calls)}%`;
    const calls = k === "escalate" ? n(m, "so") + n(m, "of") : m.calls;
    out[k] = { model: m.model, calls, p50: quant(l, 0.5), p95: quant(l, 0.95), signal, warn };
  }
  store.metrics = out;
  store.kpis = [];
}

function metric(role: keyof typeof M, ms: number | null, patch?: (m: Tally) => void): void {
  const m = M[role];
  m.calls++;
  if (ms != null) { m._lat.push(ms); if (m._lat.length > 60) m._lat.shift(); }
  if (patch) patch(m);
  publish();
}

function* escalate(s: CSession, b: Builder[], i: number, task: string): Gen {
  simEsc(s, i, task);
  b[i] = "failed";
  set(s, { stage: 4, status: "escalated", esc: true, builders: b.slice(), msg: `B${i + 1} escalated · Sonnet ✗✗ → Opus`, action: null });
  say(s, `B${i + 1} failed done-criteria twice on ${task} → re-running on Opus`);
  metric("escalate", null, (m) => inc(m, "so"));
  yield R(5, 8);
  if (Math.random() < 0.5) { say(s, `Opus solved ${task} · no Fable needed`); metric("build", lat(14e3, 40e3)); }
  else {
    set(s, { msg: `B${i + 1} escalated · Sonnet ✗✗ → Opus ✗ → Fable` }); say(s, `Opus failed too → one Fable run on ${task}`);
    metric("escalate", null, (m) => inc(m, "of"));
    yield R(7, 10);
    if (Math.random() < 0.7) { say(s, `Fable solved ${task} ✓`); metric("escalate", null, (m) => { m.calls--; inc(m, "fok"); }); }
    else {
      set(s, { status: "handoff", msg: `Fable ✗ · B${i + 1} handed to you with 3 reports`, action: `RESOLVE B${i + 1} · 3 REPORTS` });
      say(s, `All three attempts failed on ${task}. Reports from Sonnet, Opus and Fable are ready.`);
      yield R(20, 32); say(s, `B${i + 1} resolved by you`);
    }
  }
  b[i] = "done"; set(s, { stage: 3, status: "active", esc: false, builders: b.slice(), msg: null, action: null });
}

function* build(s: CSession, N: number): Gen {
  let done = 0;
  while (done < N) {
    const k = Math.min(3, N - done);
    const rem = [0, 1, 2].map((i) => (i < k ? R(7, 18) : 0));
    const b: Builder[] = [0, 1, 2].map((i): Builder => (i < k ? "working" : "idle"));
    const tasks = [0, 1, 2].map(() => pick(WORK));
    set(s, { stage: 3, status: "active", builders: b.slice(), tasksDone: done, tasksTotal: N, msg: null });
    say(s, `Dispatched ${k} task${k > 1 ? "s" : ""} · ${tasks.slice(0, k).join(", ")}`);
    while (b.includes("working")) {
      yield 1000 / SPEED;
      for (let i = 0; i < 3; i++) {
        if (b[i] !== "working") continue;
        rem[i] -= 1000 / SPEED;
        if (Math.random() < 0.03) { metric("judge", lat(250, 900), (m) => inc(m, "judged")); if (Math.random() < 0.3) say(s, `B${i + 1} · ${pick(["test fails for the right reason → implementing", "tests green · refactoring", "writing failing test first"])} (${tasks[i]})`); }
        if (Math.random() < 0.008) {
          const cmd = pick(CMDS); b[i] = "blocked";
          metric("judge", lat(300, 1200), (m) => { inc(m, "judged"); inc(m, "deny"); });
          set(s, { status: "deny", deny: i, builders: b.slice(), msg: `Jev denied B${i + 1} · ${cmd}`, action: "REVIEW DENY" });
          say(s, `Jev stopped B${i + 1}: “${cmd}” (p(safe) 0.04). Builder paused.`);
          yield R(8, 12);
          b[i] = "working"; set(s, { status: "active", deny: null, builders: b.slice(), msg: null, action: null }); say(s, `B${i + 1} resumed with a safer approach`);
        }
        if (rem[i] <= 0 && b[i] === "working") {
          if (Math.random() < 0.18) yield* escalate(s, b, i, tasks[i]);
          else { b[i] = "done"; set(s, { builders: b.slice() }); say(s, `Jev: B${i + 1} done ✓ · ${tasks[i]} · tests green`); metric("build", lat(6e3, 28e3), (m) => inc(m, "pass")); metric("judge", lat(250, 700)); }
          done++; set(s, { tasksDone: done });
        }
      }
    }
  }
}

function* life(s: CSession): Gen {
  for (;;) {
    set(s, { stage: 0, status: "active", builders: I3(), tasksDone: 0, tasksTotal: 0, msg: null, action: null, esc: false, deny: null, startedAt: now() });
    say(s, `Orchestrator is asking about ${pick(BRAIN)}`); metric("plan", lat(8e3, 25e3)); yield R(6, 12);
    set(s, { status: "waiting", msg: "Waiting on you · review spec", action: "REVIEW SPEC" }); say(s, "Spec ready. Waiting for your review before planning."); yield R(16, 28);
    const N = 2 + ((Math.random() * 3) | 0);
    set(s, { stage: 1, status: "active", msg: null, action: null }); say(s, "Searching memory · 3 past outcomes (what worked, what failed)"); yield R(4, 7);
    say(s, `PLAN.md written in a worktree · ${N} tasks, each with a failing test first`); metric("plan", lat(12e3, 40e3)); yield R(2, 4);
    if (Math.random() < 0.45) {
      set(s, { status: "waiting", msg: `Waiting on you · approve plan (${N} tasks)`, action: "APPROVE PLAN" }); metric("plan", null, (m) => { m.calls--; inc(m, "asked"); }); say(s, `Plan ready · ${N} tasks. Approve to dispatch.`); yield R(14, 24);
      set(s, { status: "active", msg: null, action: null }); metric("plan", null, (m) => inc(m, "ok"));
    }
    set(s, { stage: 2, tasksDone: 0, tasksTotal: N }); say(s, `Jev triage · ${N} tasks: executor, specific, failing test, needs Opus`);
    for (let i = 0; i < N; i++) metric("judge", lat(280, 950), (m) => inc(m, "judged"));
    yield R(4, 7);
    yield* build(s, N);
    set(s, { stage: 5 }); say(s, "/wreview · checking spec compliance"); yield R(4, 6); metric("review", lat(1e4, 3e4), (m) => inc(m, "ok"));
    say(s, "Spec ✓ · checking code quality"); yield R(4, 6); metric("review", lat(1e4, 3e4), (m) => inc(m, "ok"));
    say(s, "Quality ✓ · verification before completion"); yield R(3, 5);
    set(s, { stage: 6 }); say(s, "Jev: safe to commit? yes (0.91)"); metric("judge", lat(300, 800)); yield R(3, 5);
    set(s, { status: "shipped", msg: `Shipped · merged to main · ${N}/${N} tasks` }); say(s, `Committed and merged to main · ${N}/${N} tasks`);
    if (store.usage) store.usage.session.used = Math.min(0.99, store.usage.session.used + 0.01);
    yield R(9, 13);
    if (Math.random() < 0.35) { set(s, { status: "idle", msg: null }); say(s, "Idle · waiting for your next prompt"); yield R(90, 240); }
  }
}

const sim: { on: boolean; runs: { s: CSession; gen: Gen; wake: number }[]; timer: ReturnType<typeof setInterval> | null } = { on: false, runs: [], timer: null };

const HOSTS: Record<string, Omit<Host, "at">> = {
  ok: { cpu: 0.18, gpu: 0.12, mem: { used: 0.52, pressure: "normal" }, disks: [{ label: "System", path: "/", used: 0.41, freeBytes: 412e9 }, { label: "External", path: "/Volumes/External", used: 0.62, freeBytes: 380e9 }] },
  warn: { cpu: 0.88, gpu: 0.93, mem: { used: 0.81, pressure: "warn" }, disks: [{ label: "System", path: "/", used: 0.41, freeBytes: 412e9 }, { label: "External", path: "/Volumes/External", used: 0.87, freeBytes: 130e9 }] },
  crit: { cpu: 0.97, gpu: 0.95, mem: { used: 0.94, pressure: "critical" }, disks: [{ label: "System", path: "/", used: 0.96, freeBytes: 10e9 }, { label: "External", path: "/Volumes/External", used: 0.62, freeBytes: 380e9 }] },
  offline: { cpu: 0.18, gpu: null, mem: { used: 0.52, pressure: "normal" }, disks: [{ label: "System", path: "/", used: 0.41, freeBytes: 412e9 }, { label: "External", path: "/Volumes/External", used: null, freeBytes: null }] },
};
/** ?host=ok|warn|crit|offline: a fixed host sample for the demo and visual baselines. */
export function simHost(kind: string): void {
  store.host = { at: now(), ...structuredClone(HOSTS[kind] ?? HOSTS.ok) };
  changed();
}

function seedMetrics(): void {
  simHost("ok");
  const L = (a: number, b: number, c: number) => Array.from({ length: c }, () => lat(a, b));
  M = {
    plan: { role: "PLAN", model: "OPUS", calls: 41, _lat: L(8e3, 40e3, 30), ok: 9, asked: 10 },
    build: { role: "BUILD", model: "SONNET", calls: 214, _lat: L(6e3, 30e3, 60), pass: 178 },
    judge: { role: "JUDGE", model: "JEV 1.13", calls: 1180, _lat: L(220, 1100, 60), judged: 1180, tools: 5600, deny: 3, ask: 7, over: 41 },
    escalate: { role: "ESCALATE", model: "OPUS → FABLE", calls: 0, _lat: [], so: 7, of: 2, fok: 1 },
    review: { role: "REVIEW", model: "OPUS", calls: 36, _lat: L(1e4, 3e4, 30), ok: 34 },
  };
  publish();
  const t = now(), d = new Date(t);
  store.usage = {
    session: { used: 0.58, startedAt: t - 3.1 * 3600e3, windowMs: 5 * 3600e3 },
    weekly: { used: 0.41, resetsAt: t + 3.2 * 86400e3 },
    fable: { used: 0.18, resetsAt: t + 3.2 * 86400e3 },
    jev: { usedUsd: 2.1, budgetUsd: 5, monthStart: new Date(d.getFullYear(), d.getMonth(), 1).getTime() },
    at: t,
  } satisfies Usage;
}

export function stopSim(): void {
  if (sim.timer) clearInterval(sim.timer);
  sim.timer = null; sim.on = false; sim.runs = [];
  agentSim.timers.forEach(clearTimeout); agentSim.timers = [];
  if (agentSim.tick) clearInterval(agentSim.tick);
  agentSim.tick = null; agentSim.code = null;
}

export function startSim(count: number): void {
  stopSim();
  store.sessions.clear(); sim.on = true;
  store.demo = true; store.link = "live"; store.spendBase = null;
  seedMetrics();
  store.blockedMs = 23 * 60000; store.blockedWindowMs = 11 * 60000;
  store.ff = true;
  NAMES.slice(0, count).forEach((name, i) => {
    const s: CSession = { id: name, name, order: i, stage: 0, status: "active", builders: I3(), tasksDone: 0, tasksTotal: 0, deny: null, esc: false, msg: null, action: null, say: null, openUrl: null,
      startedAt: now(), since: now(), lastEventAt: now(), nodes: [], stageAt: [now(), null, null, null, null, null, null], log: [], seen: true, washAt: 0 };
    store.sessions.set(s.id, s);
    simNodes(s);
    const gen = life(s); let acc = 0; const ffms = (Math.random() * 150000) / SPEED;
    while (acc < ffms) { const r = gen.next(); if (r.done) break; acc += r.value; }
    s.startedAt -= ffms; s.since = now() - Math.random() * 90000; s.seen = true;
    if (s.say) s.say.t = now() - Math.random() * 60000;
    sim.runs.push({ s, gen, wake: now() + (acc - ffms) });
  });
  store.ff = false;
  resetPager(); changed();
  let last = now();
  sim.timer = setInterval(() => {
    const t = now(), dt = t - last; last = t;
    if (!sim.on || store.link !== "live") return;
    for (const r of sim.runs) if (t >= r.wake) { const g = r.gen.next(); if (!g.done) r.wake = t + g.value; }
    if ([...store.sessions.values()].some((x) => x.status === "waiting" || x.status === "deny" || x.status === "handoff")) { store.blockedMs += dt; store.blockedWindowMs += dt; }
    if (store.usage) {
      store.usage.session.used = Math.min(0.99, store.usage.session.used + 0.00002 * store.sessions.size);
      store.usage.weekly.used = Math.min(0.99, store.usage.weekly.used + 0.000004 * store.sessions.size);
      store.usage.at = now();
    }
  }, 100);
}

export function simKey(k: string): boolean {
  if (k === "r" && agentSim.code) { startAgents(agentSim.code, true); return true; }
  if (k === "0" || k === "1" || k === "4" || k === "7") { startSim(Number(k)); return true; }
  if (k === "o") { store.link = store.link === "offline" ? "live" : "offline"; store.retryAt = now() + 8000; changed(); return true; }
  if (k.length !== 1 || !"wexfsi".includes(k)) return false;
  const s = store.sessions.get(pager.focus ?? "") ?? [...store.sessions.values()][0];
  if (!s) return true;
  if (k === "w") set(s, { status: "waiting", stage: Math.max(1, Math.min(s.stage, 1)), msg: "Waiting on you · approve plan (3 tasks)", action: "APPROVE PLAN" });
  if (k === "e" || k === "f") simEsc(s, 0, "parse_date edge cases");
  if (k === "i") set(s, { status: "idle", builders: I3(), deny: null, esc: false, msg: null, action: null });
  if (k === "e") set(s, { status: "escalated", stage: 4, esc: true, builders: ["failed", "done", "working"], tasksTotal: 3, tasksDone: 1, msg: "B1 escalated · Sonnet ✗✗ → Opus ✗ → Fable", action: null });
  if (k === "f") set(s, { status: "handoff", stage: 4, esc: true, builders: ["failed", "done", "working"], tasksTotal: 3, tasksDone: 1, msg: "Fable ✗ · B1 handed to you with 3 reports", action: "RESOLVE B1 · 3 REPORTS" });
  if (k === "x") set(s, { status: "deny", stage: 3, deny: 2, builders: ["working", "working", "blocked"], tasksTotal: 3, tasksDone: 0, msg: "Jev denied B3 · rm -rf ./migrations", action: "REVIEW DENY" });
  if (k === "s") set(s, { status: "shipped", stage: 6, msg: "Shipped · merged to main · 3/3 tasks", action: null });
  return true;
}

/** ?ctx=ok|warn|crit: context on the first demo card; ?ctx=saved adds a saved handoff (CLEAR becomes the next step). */
export function simCtx(kind: string): void {
  const s = [...store.sessions.values()][0];
  if (!s) return;
  const pct = kind === "crit" ? 0.67 : kind === "warn" ? 0.61 : 0.42;
  s.ctx = { pct, tokens: Math.round(pct * 200_000), window: 200_000, level: kind === "crit" ? "crit" : kind === "warn" ? "warn" : "ok" };
  if (kind === "saved") s.handoff = { savedAt: now() - 60_000 };
  changed();
}

// ================= agents simulator (?agents=a..f) =================
const TOOLS = ["Read", "Edit", "Bash", "Grep", "Read", "Edit", "Glob", "Write"];
type Wake = { state: WireAgent["state"]; run: { tool: string; age: number } | null };
const amem = new WeakMap<WireAgent, { pin?: boolean; hold?: boolean; wake?: Wake }>();
const agentSim = { code: null as string | null, timers: [] as ReturnType<typeof setTimeout>[], tick: null as ReturnType<typeof setInterval> | null };
const ago = (sec: number) => now() - sec * 1000;
const run = (tool: string, sec: number) => ({ tool, since: ago(sec) });
type AO = Partial<WireAgent> & { id: string; pin?: boolean; hold?: boolean; wake?: Wake };
function mkA(o: AO): WireAgent {
  const { pin, hold, wake, ...w } = o;
  const a: WireAgent = { type: "executor", model: "sonnet", parentId: null, spawnedAt: ago(180), endedAt: null, state: "working", task: null, running: null, toolCalls: 0, tokens: 0, escalatedFrom: null, ...w };
  amem.set(a, { pin, hold, wake });
  return a;
}
function mkS(name: string, i: number, o: Partial<CSession>, log: [number, string][] = []): CSession {
  const s: CSession = { id: name, name, order: i, stage: 3, status: "active", builders: I3(), tasksDone: 0, tasksTotal: 0, deny: null, esc: false, msg: null, action: null, say: null, openUrl: null,
    startedAt: ago(1400 + i * 300), since: ago(200), lastEventAt: now(), nodes: [], stageAt: [ago(1400 + i * 300), null, null, null, null, null, null], log: [], seen: true, washAt: 0, agents: [], ...o };
  log.slice().sort((a, b) => b[0] - a[0]).forEach(([sec, text]) => s.log.push({ t: ago(sec), text }));
  s.say = s.log[s.log.length - 1] ?? null;
  return s;
}
const B4 = (i = 0) => mkS("flowobserve", i, { status: "waiting", seen: false, tasksDone: 1, tasksTotal: 4, msg: "Executor 4 needs permission · Bash", action: "ALLOW BASH", agents: [
  mkA({ id: "b1", taskId: "demo:1", role: "coder", task: "Parse ISO dates with offsets in parse_date", state: "done", endedAt: ago(9), pin: true, toolCalls: 31, tokens: 52800, spawnedAt: ago(251) }),
  mkA({ id: "b2", taskId: "demo:2", role: "coder", task: "Migrate the session store to schema v3", running: run("Edit", 72), hold: true, toolCalls: 44, tokens: 71300, spawnedAt: ago(250) }),
  mkA({ id: "b3", taskId: "demo:3", role: "coder", task: "Empty-state copy for the cards zone", running: run("Read", 8), toolCalls: 19, tokens: 23900, spawnedAt: ago(250) }),
  mkA({ id: "b4", taskId: "demo:4", role: "coder", task: "CSV export of shipped tasks with a header row", state: "waiting", running: run("Bash", 37), toolCalls: 12, tokens: 18400, spawnedAt: ago(249) })] },
  [[290, "Jev triage · 4 tasks, all executor-sized"], [251, "Dispatched 4 executors in parallel"], [37, "Executor 4 is waiting for permission to run Bash"], [9, "Executor 1 done ✓ · parse_date · tests green"]]);
const REVIEW3 = (p: string) => [
  mkA({ id: p + "r1", type: "reviewer", model: "opus", task: "Spec compliance · PLAN.md tasks 1–4 against the diff", running: run("Read", 21), toolCalls: 17, tokens: 38800, spawnedAt: ago(95) }),
  mkA({ id: p + "r2", type: "reviewer", model: "sonnet", task: "Code quality · naming, dead code, tests on changed files", running: run("Grep", 9), toolCalls: 26, tokens: 30100, spawnedAt: ago(94) }),
  mkA({ id: p + "i1", type: "interrogate", model: "opus", task: "Interrogate the retry design: what happens on a half-open socket?", running: run("Task", 48), hold: true, toolCalls: 9, tokens: 21400, spawnedAt: ago(80) })];
type Scn = { S: CSession[]; pick?: string; zoom?: "out"; script?: [number, () => void][] };
const SCN: Record<string, () => Scn> = {
  a: () => ({ S: [mkS("flowobserve", 0, { tasksTotal: 1, agents: [mkA({ id: "a1", task: "Add retry with exponential backoff to the websocket reconnect path", running: run("Edit", 42), hold: true, toolCalls: 23, tokens: 41200, spawnedAt: ago(196) })] },
    [[300, "PLAN.md written · 1 task, failing test first"], [210, "Jev triage · executor, specific, failing test"], [196, "Dispatched 1 executor · websocket retry with backoff"], [95, "Executor · test fails for the right reason → implementing"]])] }),
  b: () => ({ S: [B4()], pick: "b4" }),
  c: () => {
    const s = mkS("flowobserve", 0, { tasksDone: 1, tasksTotal: 3, agents: [
      mkA({ id: "c1", taskId: "demo:1", role: "coder", task: "Parse ISO dates with offsets in parse_date", state: "done", endedAt: ago(10), pin: true, toolCalls: 28, tokens: 40100, spawnedAt: ago(300) }),
      mkA({ id: "c2", taskId: "demo:2", role: "coder", task: "Retry with backoff on websocket reconnect", running: run("Bash", 14), toolCalls: 61, tokens: 88200, spawnedAt: ago(299) }),
      mkA({ id: "c3", taskId: "demo:3", role: "coder", task: "Refresh the auth token before it expires", running: run("Edit", 20), toolCalls: 37, tokens: 50300, spawnedAt: ago(298) })] },
      [[299, "Dispatched 3 executors in parallel"], [10, "Executor 1 done ✓ · parse_date · tests green"]]);
    const a2 = () => s.agents!.find((a) => a.id === "c2")!;
    return { S: [s], pick: "c2", script: [
      [2600, () => { Object.assign(a2(), { state: "failed", running: null, endedAt: now() }); setS(s, { status: "escalated", msg: "Executor 2 failed on Sonnet · re-dispatching on Opus" }); say(s, "Executor 2 failed done-criteria on Sonnet → re-dispatching on Opus"); }],
      [3800, () => { a2().state = "escalated"; s.agents!.push(mkA({ id: "c2o", model: "opus", escalatedFrom: "sonnet", task: a2().task, spawnedAt: now(), running: run("Read", 0), toolCalls: 1, tokens: 2100 })); setS(s, { stage: 4, msg: "Executor 2 escalated · Sonnet ✗ → Opus" }); say(s, "Executor 2 re-dispatched on Opus with the failing test attached"); }]] };
  },
  d: () => ({ S: [mkS("flowobserve", 0, { stage: 5, tasksDone: 4, tasksTotal: 4, agentTally: { spawned: 10, passed: 5, failed: 1, escalated: 1 }, agents: [...REVIEW3(""),
      mkA({ id: "i2", type: "interrogate", model: "sonnet", parentId: "i1", task: "Answer as the implementer, citing the diff", running: run("Read", 5), toolCalls: 14, tokens: 17600, spawnedAt: ago(52) })] },
    [[120, "Build done · 4/4 tasks · 1 escalation (Sonnet → Opus)"], [95, "/wreview · 2 reviewers + interrogate pair"], [40, "Interrogator asks: half-open socket → does retry ever stop?"]])], pick: "i1" }),
  e: () => ({ zoom: "out", S: [B4(0),
    mkS("atlas", 1, { tasksDone: 3, tasksTotal: 9, agents: [
      mkA({ id: "p1", taskId: "demo:1", role: "coder", task: "Image resize worker", state: "done", endedAt: ago(6), pin: true, toolCalls: 22, tokens: 31000 }),
      mkA({ id: "p2", taskId: "demo:2", role: "coder", task: "Thumbnail cache eviction", state: "failed", endedAt: ago(40), toolCalls: 48, tokens: 77000 }),
      mkA({ id: "p3", taskId: "demo:3", role: "coder", task: "Upload progress events", state: "done", endedAt: ago(70), toolCalls: 35, tokens: 41000 }),
      mkA({ id: "p4", taskId: "demo:4", role: "coder", task: "EXIF strip on upload", running: run("Bash", 12), toolCalls: 19, tokens: 22000 }),
      mkA({ id: "p5", taskId: "demo:5", role: "coder", task: "Retry on S3 503", running: run("Read", 4), toolCalls: 27, tokens: 30000 }),
      mkA({ id: "p6", taskId: "demo:6", role: "coder", task: "Content-type sniffing", running: run("Grep", 7), toolCalls: 15, tokens: 18000 }),
      mkA({ id: "p7", taskId: "demo:7", role: "coder", task: "Thumbnail LRU sizing", state: "done", endedAt: ago(120), toolCalls: 18, tokens: 26000 }),
      mkA({ id: "p8", taskId: "demo:8", role: "coder", task: "Dedupe upload retries by content hash", state: "escalated", endedAt: ago(55), model: "haiku", toolCalls: 14, tokens: 12000 }),
      mkA({ id: "p9", taskId: "demo:8", role: "coder", model: "sonnet", escalatedFrom: "haiku", task: "Dedupe upload retries by content hash", running: run("Edit", 9), toolCalls: 3, tokens: 4200, spawnedAt: ago(54) })] }, [[180, "Dispatched 6 executors"], [55, "Executor 8 escalated · Haiku → Sonnet"], [40, "Executor 2 failed · thumbnail cache eviction"]]),
    mkS("dryas", 2, { tasksTotal: 1, agents: [mkA({ id: "d1", task: "Rate-limit the KPI endpoint", running: run("Edit", 64), toolCalls: 30, tokens: 39000 })] }, [[150, "Dispatched 1 executor · KPI rate limit"]]),
    mkS("harbor", 3, { stage: 5, tasksDone: 3, tasksTotal: 3, agentTally: { spawned: 6, passed: 3, failed: 0, escalated: 0 }, agents: REVIEW3("x") }, [[90, "/wreview · 2 reviewers + interrogate"]]),
    mkS("meadow", 4, { stage: 1, agents: [mkA({ id: "m1", type: "explore", model: "haiku", task: "Map how the auth middleware is wired across services", running: run("Grep", 12), toolCalls: 11, tokens: 9000, spawnedAt: ago(40) })] }, [[40, "Exploring the codebase before planning"]])] }),
  f: () => {
    const t0 = now() + 400, ex = ["parse_date edge cases", "session store migration", "retry with backoff", "auth token refresh", "empty-state copy", "websocket reconnect", "CSV export", "KPI rate limit", "drawer focus trap", "pager page dots"];
    const W = (tool: string): Wake => ({ state: "working", run: { tool, age: 0 } });
    const ag = ex.map((task, i) => mkA({ id: "f" + i, taskId: "demo:" + (i + 1), role: "coder", task, spawnedAt: t0 + i * 150, state: "spawning", wake: W(TOOLS[i % TOOLS.length]) }));
    ag.push(mkA({ id: "fx", type: "explore", parentId: "f3", task: "Find every caller of the token store", spawnedAt: t0 + 1500, state: "spawning", wake: W("Grep") }));
    ag.push(mkA({ id: "fg", type: "general", parentId: "fx", task: "Summarise the call sites by module", spawnedAt: t0 + 1850, state: "spawning", wake: W("Read") }));
    return { S: [mkS("flowobserve", 0, { tasksTotal: 10, agents: ag }, [[60, "PLAN.md written · 10 independent tasks"], [20, "Jev triage · 10 executor tasks, no shared files"], [1, "Dispatching 10 executors in parallel"]])], pick: "fg" };
  },
};
/** ?replay: every agent restarts as spawning, 160 ms apart, then wakes into its scenario state. */
function intro(S: CSession[]): void {
  const t0 = now() + 300;
  for (const s of S) (s.agents ?? []).slice().sort((a, b) => a.spawnedAt - b.spawnedAt).forEach((a, i) => {
    const m = amem.get(a) ?? {};
    if (!m.wake && a.state !== "spawning") m.wake = { state: a.state, run: a.running ? { tool: a.running.tool, age: now() - a.running.since } : null };
    amem.set(a, m);
    a.state = "spawning"; a.running = null; a.spawnedAt = t0 + i * 160;
  });
}
function simPick(want?: string): void {
  const s = store.sessions.get(pager.focus ?? ""), v = s ? agentView(s, now()) : null;
  if (!s || !v) return;
  const L = v.order.find((x) => x.id === want) ?? v.order.find((x) => needsLook(x.head.state)) ?? v.order[0];
  if (L) { ui.agentSel = { sid: s.id, aid: L.id, at: Number.POSITIVE_INFINITY }; changed(); } // pinned: the 60 s clear never fires
}
function agentTick(): void {
  if (!agentSim.code || store.link !== "live") return;
  const t = now(); let any = false;
  for (const s of store.sessions.values()) for (const a of s.agents ?? []) {
    if (a.spawnedAt > t) continue;
    const m = amem.get(a) ?? {};
    if (m.wake && t >= a.spawnedAt + 1200 / SPEED) {
      a.state = m.wake.state; a.running = m.wake.run ? { tool: m.wake.run.tool, since: t - Math.min(m.wake.run.age, 2000) } : null;
      if (a.state === "done") a.endedAt = t;
      if (a.state === "working") a.toolCalls++;
      delete m.wake; any = true;
    }
    if (m.pin && a.endedAt) a.endedAt = Math.max(a.endedAt, t - 9000);
    if (a.state === "working" && Math.random() < 0.09 * SPEED) {
      a.toolCalls++; a.tokens += (300 + Math.random() * 2200) | 0; any = true; s.lastEventAt = t;
      if (!m.hold && Math.random() < 0.3) a.running = { tool: pick(TOOLS), since: t };
    }
  }
  if (any) changed();
}
/** ?agents=a..f (prototype P:517-612): a: one agent · b: four, one waiting · c: escalation · d: review · e: five projects, overview · f: ten-way fan-out. */
export function startAgents(code: string, replay = false, pickIt = false): void {
  const f = SCN[code];
  if (!f) { startSim(4); return; }
  stopSim();
  agentSim.code = code;
  store.sessions.clear(); store.demo = true; store.link = "live"; store.spendBase = null;
  seedMetrics(); store.blockedMs = 23 * 60000; store.blockedWindowMs = 11 * 60000;
  const sc = f();
  sc.S.forEach((s) => { simNodes(s); store.sessions.set(s.id, s); });
  if (replay) intro(sc.S);
  const lag = replay ? 1600 : 0;
  for (const [ms, fn] of sc.script ?? []) agentSim.timers.push(setTimeout(() => { fn(); changed(); }, ms / SPEED + lag));
  resetPager(); pager.focus = sc.S[0].id; ui.agentSel = null;
  if (sc.zoom === "out") { view.zt = view.z = 0; pager.pinUntil = now() + 864e5; } else view.zt = 1;
  if (pickIt) agentSim.timers.push(setTimeout(() => simPick(sc.pick), Math.max(0, ...(sc.script ?? []).map((x) => x[0])) / SPEED + lag + 2400));
  agentSim.tick = setInterval(agentTick, 250);
  changed();
}
