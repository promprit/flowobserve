import fs from "node:fs";
import path from "node:path";
import { isPaletteColor, toWire, type Ctx, type Edition, type Event, type Host, type Kpi, type Limit, type MetricsMsg, type ProjectsMsg, type Session, type SessionState, type SnapshotMsg, type Spend, type Usage } from "@fo/shared";
import { DAY_MS, FIVE_HOUR_MS, JEV_BUDGET_USD, JEV_MODEL, KPI_FETCH_MS, KPI_SOURCE, USAGE_PUSH_MS, CARD_TTL_MS, REGISTRY_GRACE_MS } from "./config";
import { readDoc, type DocResult } from "./docs";
import { kpis as computeKpis } from "./kpi";
import type { ClaudeUsage } from "./usagecache";
import { parseSpoolLine, toEvents } from "./ingest";
import { parseJevLine, type JevLine } from "./jev";
import { aggregateSpend, blockedMs, jevUsage, localMidnight, metrics, monthStart, rangeStart, type Range } from "./queries";
import { worktreeOf } from "./worktree";
import { realFs, scanProjects, withPicks, type FsLike, type Scan, type ScanProject } from "./projects";
import { emptyEmit, initState, openCycleRow, PASSIVE, projectName, reduce, tick, type Emit } from "./reducer";
import type { Store, StoredSpend } from "./store";
import { ctxOf, ctxTokens, warnPctFrom, type RcMark, type TItem, type TMsg } from "./transcript";
import { baseModel, priceUsd } from "./pricing";

export interface Outbox {
  session?(s: Session): void;
  usage?(u: Usage): void;
  metrics?(m: MetricsMsg): void;
  snapshot?(m: SnapshotMsg): void;
  projects?(m: ProjectsMsg): void;
}

export type { ClaudeUsage };

const COLORS_KEY = "colors";
/** Same rule as the PWA's NAME_RE (pwa/src/helper.ts). */
const NAME_RE = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,62}[A-Za-z0-9_-])?$/;

type ExtraRoot = { label: string; path: string };
/** createRoots from helper.json, label + path; the projects root is always first. Missing or malformed → projects root only. */
export function createRootsOf(helperJsonPath: string, root: string): ExtraRoot[] {
  const out = [{ label: "projects", path: root }];
  try {
    const list = (JSON.parse(fs.readFileSync(helperJsonPath, "utf8")) as { createRoots?: unknown }).createRoots;
    for (const x of Array.isArray(list) ? (list as { label?: unknown; path?: unknown }[]) : []) {
      if (typeof x.label === "string" && x.label && x.label !== "projects" && typeof x.path === "string" && path.isAbsolute(x.path)
          && !out.some((o) => o.label === x.label)) out.push({ label: x.label, path: x.path });
    }
  } catch { /* projects root only */ }
  return out;
}

export class Engine {
  out: Outbox = {};
  readonly sessions = new Map<string, SessionState>();
  readonly counts: Record<string, number> = {};
  private usage: ClaudeUsage | null = null;
  private host: Host | null = null;
  private wire = new Map<string, string>();
  private metricsDirty = true;
  private kpiCache: Kpi[] | null = null;
  private kpiFailed = false;
  private usageDirty = false;
  private snapshotDirty = false;
  private liveKey = "";
  private lastUsagePush = 0;
  private readonly bootAt: number;
  transcripts: { watch(sid: string, p: string): "ok" | "same" | "rejected"; forget(sid: string): void } | null = null;
  warnPct: () => number = () => warnPctFrom(null);
  ctxWindowEnv: string | undefined = process.env.JEV_CONTEXT_WINDOW;
  private ctxTrack = new Map<string, { biggest: number }>();
  /** sid → agent id → context tokens of that subagent's newest message (numbers only; rebuilt from transcripts after a restart). */
  private agentTok = new Map<string, Record<string, number>>();
  private rejected = new Map<string, Set<string>>();
  helperJson = "";
  edition: Edition = "both";
  /** False when ~/.claude/jev/logs is missing: no JEV tile. */
  jevPresent = true;
  /** When the Mac last booted; a session silent since before it died without a SessionEnd. 0 = unknown. */
  machineBootAt = 0;
  private root: string | null = null;
  private fsys: FsLike = realFs;
  private scan: Scan = { rootMissing: false, projects: [] };
  private extraRoots: ExtraRoot[] = [];
  private rawScan: Scan = { rootMissing: false, projects: [] };
  private rawExtra: (ExtraRoot & { exists: boolean; projects: ScanProject[] })[] = [];
  private extra: (ExtraRoot & { exists: boolean; projects: ScanProject[] })[] = [];
  private token: string | null = null;
  private projectsKey = "";

  constructor(private store: Store, private now: () => number = Date.now) {
    this.bootAt = now();
  }

  load(): void {
    for (const s of this.store.loadSessions()) this.sessions.set(s.id, s);
    const u = this.store.kvGet("usage");
    if (u) {
      try { this.usage = JSON.parse(u); } catch { /* ignore corrupt value */ }
    }
  }

  private bump(k: string): void { this.counts[k] = (this.counts[k] ?? 0) + 1; }

  ingestSpool(raw: string): void {
    this.bump("lines:spool");
    const l = parseSpoolLine(raw);
    if (!l) return this.bump("malformed");
    if (!l.sid && l.src === "helper") {
      const p = l.payload as { action?: unknown; ok?: unknown } | null;
      // New project belongs to no session: count create success and failure, never orphan it.
      if (p?.action === "new") return this.bump(p.ok === true ? "new:ok" : "new:failed");
      const t = this.live().filter((x) => x.folderAbs === l.cwd).sort((a, b) => b.lastEventAt - a.lastEventAt)[0];
      if (!t) return this.bump("helper-orphan");
      l.sid = t.id;
    }
    if (!l.sid) return this.bump("nosid");
    if (l.truncated) this.bump("truncated");
    const events = toEvents(l);
    if (!events) return this.bump(`unknown:${l.event}`);
    const tp = (l.payload as { transcript_path?: unknown } | null)?.transcript_path;
    if (typeof tp === "string" && this.transcripts && this.transcripts.watch(l.sid, tp) === "rejected") {
      const r = this.rejected.get(l.sid) ?? new Set<string>();
      if (!r.has(tp)) { r.add(tp); this.rejected.set(l.sid, r); this.bump("transcriptRejected"); }
    }
    for (const e of events) this.apply(e);
  }

  ingestJev(file: string, raw: string): void {
    this.bump("lines:jev");
    const j = parseJevLine(file, raw);
    if (!j) return this.bump("jev:malformed");
    const sid = this.attribute(j);
    if (!sid) this.bump("jev:unattributed");
    const s = sid ? this.sessions.get(sid)! : null;
    const emit = emptyEmit();
    if (j.cost > 0) {
      emit.spend.push({ ts: j.ts, sid, project: s?.name ?? this.fallbackProject(j), model: JEV_MODEL, source: "jev", usd: j.cost });
      this.usageDirty = true;
    }
    if (j.kind === "override") {
      emit.calls.push({ ts: j.ts, sid: sid ?? "", role: "override", model: "opus", ms: null, ok: null });
      this.metricsDirty = true;
    }
    this.store.insert(emit);
    if (s && j.kind === "deny")
      this.apply({ ts: j.ts, sid: s.id, cwd: s.cwd, project: s.cwd, worktree: s.worktree, agentId: null, k: "JevDeny", tool: j.tool, command: `${j.tool} ${j.head}`.trim() });
    if (s && j.kind === "ask")
      this.apply({ ts: j.ts, sid: s.id, cwd: s.cwd, project: s.cwd, worktree: s.worktree, agentId: null, k: "JevAsk", tool: j.tool });
  }

  private fallbackProject(j: JevLine): string {
    if (j.cwd) return projectName(worktreeOf(j.cwd).project);
    return `Jev · ${j.file}`;
  }

  attribute(j: JevLine): string | null {
    if (j.sid) return this.sessions.has(j.sid) ? j.sid : null;
    let c = [...this.sessions.values()].filter((s) => !s.retired && !s.spare);
    const jw = j.cwd ? worktreeOf(j.cwd) : null;
    if (jw) c = c.filter((s) => jw.project === s.cwd || jw.project.startsWith(s.cwd + "/"));
    c = j.kind === "deny" || j.kind === "ask"
      ? c.filter((s) => s.lastPre !== null && s.lastPre.tool === j.tool && Math.abs(s.lastPre.ts - j.ts) <= 2000)
      : c.filter((s) => Math.abs(s.lastEventAt - j.ts) <= 10_000);
    if (c.length > 1 && jw) {
      const exact = c.filter((s) => s.worktree === jw.worktree);
      if (exact.length) c = exact;
    }
    c.sort((a, b) => b.lastEventAt - a.lastEventAt);
    if (c.length > 1 && c[0].lastEventAt === c[1].lastEventAt) return null; // a true tie stays unattributed
    return c[0]?.id ?? null;
  }

  private sessionFor(e: Event): SessionState {
    const found = this.sessions.get(e.sid);
    if (found) return found;
    const s = initState(e.sid, e.cwd, e.ts, e);
    this.store.insert({ ...emptyEmit(), cycles: [openCycleRow(s)] });
    return s;
  }

  private apply(e: Event): void {
    if (e.project === undefined) { const w = worktreeOf(e.cwd); e = { ...e, project: w.project, worktree: w.worktree }; }
    const prev = this.sessionFor(e);
    const r = reduce(prev, e);
    if (r.state.retired && e.k !== "End" && !PASSIVE.has(e.k)) r.state.retired = false;
    if (r.state.retired !== prev.retired || !r.state.spare !== !prev.spare) this.snapshotDirty = true;
    const liveChanged = this.snapshotDirty;
    this.commit(r.state, r.emit);
    if (liveChanged && e.k !== "End" && e.k !== "SessionSeen") this.refreshProjects();
    if (e.k === "End" && r.state.lastEnd === "other" && (r.state.prompts ?? 0) > 0 && !r.state.spare) {
      this.store.closedUpsert({ id: r.state.id, project: r.state.cwd, folder: r.state.folderAbs ?? r.state.cwd, endedAt: e.ts, title: r.state.title });
      this.refreshProjects();
    } else if (e.k === "SessionSeen") {
      this.store.closedDelete(r.state.id);
      this.refreshProjects();
    }
    this.liveKey = this.live().map((x) => x.id).join("\n");
    if (e.k === "Usage" && e.fiveHour && e.sevenDay) {
      this.setUsage({ fiveHour: e.fiveHour, sevenDay: e.sevenDay, fable: null, at: e.ts });
    }
  }

  /** One deduped transcript message (spec §9.2-9.3); see onTranscripts. */
  onTranscript(sid: string, m: TMsg, main: boolean): void { this.onTranscripts([{ sid, m, main }]); }

  /** All new messages of one poll: main-chain messages set CTX (once per sid, last value);
   * every priced message is a spend row keyed by message id, all written in one transaction. */
  onTranscripts(items: TItem[]): void {
    const spend: StoredSpend[] = [];
    const ctxNext = new Map<string, Ctx>();
    const tokSids = new Set<string>();
    let warn: number | null = null;
    for (const { sid, m, main, agent } of items) {
      const s = this.sessions.get(sid);
      if (!s) continue;
      const usd = priceUsd(m.model, m.usage);
      if (usd === null) this.bump("unpricedModel");
      else if (usd > 0) spend.push({ ts: m.ts ?? this.now(), sid, project: s.name, model: baseModel(m.model), source: "claude", usd, msgId: m.id });
      if (!main) {
        if (agent) {
          const t = this.agentTok.get(sid) ?? {}, v = ctxTokens(m.usage);
          if (t[agent] !== v) { t[agent] = v; this.agentTok.set(sid, t); tokSids.add(sid); }
        }
        continue;
      }
      const tokens = ctxTokens(m.usage), t = this.ctxTrack.get(sid) ?? { biggest: 0 };
      t.biggest = Math.max(t.biggest, tokens);
      this.ctxTrack.set(sid, t);
      warn ??= this.warnPct();
      ctxNext.set(sid, ctxOf(tokens, m.model, t.biggest, warn, this.ctxWindowEnv));
    }
    if (spend.length) {
      this.store.tx(() => this.store.insert({ ...emptyEmit(), spend }));
      this.usageDirty = true;
    }
    const applied = new Set<string>();
    for (const [sid, ctx] of ctxNext) {
      const s = this.sessions.get(sid)!, cur = s.ctx;
      if (cur && cur.tokens === ctx.tokens && cur.level === ctx.level && cur.window === ctx.window) continue;
      applied.add(sid);
      this.apply({ ts: this.now(), sid, cwd: s.cwd, project: s.cwd, worktree: s.worktree, agentId: null, k: "Ctx", ctx });
    }
    for (const sid of tokSids) { const s = this.sessions.get(sid); if (s && !applied.has(sid)) this.push(s); }
  }

  /** RC takeover marks from the main transcript (spec §7): a takeover sets the alarm, a later bridge clears it. */
  onRc(sid: string, r: RcMark): void {
    const s = this.sessions.get(sid);
    if (!s || s.retired) return;
    const takenOverAt = r.kind === "takeover" ? r.ts : null;
    if ((s.rc?.takenOverAt ?? null) === takenOverAt) return;
    this.apply({ ts: r.kind === "takeover" ? r.ts : this.now(), sid, cwd: s.cwd, project: s.cwd, worktree: s.worktree, agentId: null, k: "Rc", takenOverAt });
  }

  /** Exact dispatch pairing from a subagent's meta file (toolUseId only). */
  onMeta(sid: string, m: { agentId: string; useId: string }): void {
    const s = this.sessions.get(sid);
    if (!s || s.retired) return;
    this.apply({ ts: this.now(), sid, cwd: s.cwd, project: s.cwd, worktree: s.worktree, agentId: null, k: "AgentBind", subId: m.agentId, useId: m.useId });
  }

  setHandoff(sid: string, savedAt: number | null): void {
    const s = this.sessions.get(sid);
    if (!s || s.handoffAt === savedAt) return;
    this.apply({ ts: this.now(), sid, cwd: s.cwd, project: s.cwd, worktree: s.worktree, agentId: null, k: "Handoff", savedAt });
  }

  private goneSince = new Map<string, number>();
  /** Sessions seen in the registry at least once; only these can end as gone (extension sessions may never register). */
  private regSeen = new Set<string>();

  /** Registry poll: a live session whose registry entry is absent or whose pid is dead for over the grace period ends. null = no registry dir (feature off). */
  onRegistry(reg: Map<string, { pid: number; kind: string }> | null, alive: (pid: number) => boolean): void {
    if (!reg) { this.goneSince.clear(); return; }
    const now = this.now();
    for (const s of [...this.sessions.values()]) {
      if (s.retired || s.spare) { this.goneSince.delete(s.id); continue; }
      const e = reg.get(s.id);
      if (e) this.regSeen.add(s.id);
      if (!this.regSeen.has(s.id)) continue;
      if (e && alive(e.pid)) {
        this.goneSince.delete(s.id);
        if ((s.kind ?? "") !== e.kind) { s.kind = e.kind || undefined; this.store.saveSession(s); this.push(s); }
        continue;
      }
      const since = this.goneSince.get(s.id) ?? now;
      this.goneSince.set(s.id, since);
      if (now - since > REGISTRY_GRACE_MS) {
        this.goneSince.delete(s.id);
        this.apply({ k: "End", reason: "gone", ts: now, sid: s.id, cwd: s.cwd, agentId: null });
      }
    }
  }

  /** Dismiss a card; false when the session is unknown. */
  dismiss(sid: string): boolean {
    const s = this.sessions.get(sid);
    if (!s) return false;
    if (!s.retired) this.apply({ k: "End", reason: "dismissed", ts: this.now(), sid, cwd: s.cwd, agentId: null });
    return true;
  }

  /** Whether the header token is the helper token the PWA was sent. */
  tokenOk(t: string | undefined): boolean { return this.token !== null && t === this.token; }

  liveIds(): { id: string; cwd: string }[] { return this.live().map((s) => ({ id: s.id, cwd: s.cwd })); }

  setUsage(u: ClaudeUsage): void {
    if (this.usage && u.at < this.usage.at) return;
    const fable = u.fable ?? this.usage?.fable ?? null;
    this.usage = { ...u, fable };
    this.store.kvSet("usage", JSON.stringify(this.usage));
    this.usageDirty = true;
    this.lastUsagePush = 0;
  }

  private commit(s: SessionState, emit: Emit): void {
    this.sessions.set(s.id, s);
    this.store.saveSession(s);
    this.store.insert(emit);
    if (emit.calls.length || emit.transitions.length) this.metricsDirty = true;
    this.push(s);
  }

  private push(s: SessionState): void {
    if (s.retired || s.spare) return;
    const w = toWire(s, this.extraFor(s));
    const j = JSON.stringify(w);
    if (this.wire.get(s.id) === j) return;
    this.wire.set(s.id, j);
    this.out.session?.(w);
  }

  tick(): void {
    this.kpiCache = null; // KPIs refresh once per tick, not per ingest or spend poll
    const now = this.now();
    for (const s of [...this.sessions.values()])
      if (!s.retired && !s.spare && s.lastEventAt < this.machineBootAt)
        this.apply({ k: "End", reason: "other", ts: this.machineBootAt, sid: s.id, cwd: s.cwd, agentId: null });
    for (const s of this.sessions.values()) {
      if (s.retired) continue;
      const r = tick(s, now);
      if (r.emit.transitions.length) this.commit(r.state, r.emit);
    }
    for (const s of this.live()) this.push(s); // time-based wire changes (done agents dropping off)
    const liveSet = new Set(this.live().map((s) => s.id));
    for (const id of this.ctxTrack.keys()) if (!liveSet.has(id)) { this.ctxTrack.delete(id); this.transcripts?.forget(id); }
    for (const id of this.agentTok.keys()) if (!liveSet.has(id)) this.agentTok.delete(id);
    for (const s of this.sessions.values()) if (!liveSet.has(s.id)) { this.transcripts?.forget(s.id); this.rejected.delete(s.id); }
    const key = this.live().map((s) => s.id).join("\n");
    if (key !== this.liveKey) { this.liveKey = key; this.snapshotDirty = true; }
    this.flush(true);
  }

  flush(force = false): void {
    const now = this.now();
    if (this.snapshotDirty) {
      this.snapshotDirty = false;
      this.out.snapshot?.(this.snapshot());
    }
    if (this.metricsDirty || force) {
      this.metricsDirty = false;
      this.out.metrics?.(this.metricsMsg());
    }
    if (this.usageDirty && (force || now - this.lastUsagePush >= USAGE_PUSH_MS)) {
      const u = this.usageWire();
      if (u) this.out.usage?.(u);
      this.usageDirty = false;
      this.lastUsagePush = now;
    }
  }

  private live(): SessionState[] {
    const now = this.now();
    return [...this.sessions.values()]
      .filter((s) => !s.retired && !s.spare && now - s.lastEventAt < CARD_TTL_MS)
      .sort((a, b) => a.startedAt - b.startedAt);
  }

  private blocked(): { blockedMs: number; blockedWindowMs: number } {
    const now = this.now();
    const day = localMidnight(now);
    const win = this.usage && this.usage.fiveHour.resetsAt > now ? this.usage.fiveHour.resetsAt - FIVE_HOUR_MS : now - FIVE_HOUR_MS;
    return {
      blockedMs: blockedMs(this.store.transitionsFrom(day), day, now),
      blockedWindowMs: blockedMs(this.store.transitionsFrom(win), win, now),
    };
  }

  metricsMsg(): MetricsMsg {
    const k = this.currentKpis();
    return { type: "metrics", metrics: metrics(this.store.callsSince(this.now() - DAY_MS), k), kpis: k, ...this.blocked() };
  }

  /** Dryas KPIs over the last 30 days of stored rows; [] (logged) on any error, so metrics keep flowing. */
  private currentKpis(): Kpi[] {
    if (this.kpiCache) return this.kpiCache;
    const now = this.now(), from = now - KPI_FETCH_MS;
    try {
      this.kpiCache = computeKpis({
        escalations: this.store.escalationsSince(from), cycles: this.store.cyclesSince(from),
        calls: this.store.callsSince(from), spend: this.store.spendSince(from),
      }, now);
      this.kpiFailed = false;
      return this.kpiCache;
    } catch (err) {
      console.error("fo-server: kpis failed:", err);
      this.kpiCache = [];
      this.kpiFailed = true;
      return this.kpiCache;
    }
  }

  kpisReport(): { at: number; source: string; ok: boolean; kpis: Kpi[] } {
    const kpis = this.currentKpis();
    return { at: this.now(), source: KPI_SOURCE, ok: !this.kpiFailed, kpis };
  }

  usageWire(): Usage | null {
    if (!this.usage) return null;
    const now = this.now();
    const clamp = (x: number) => Math.min(1, Math.max(0, x / 100));
    const u = this.usage;
    return {
      session: { used: clamp(u.fiveHour.pct), startedAt: u.fiveHour.resetsAt - FIVE_HOUR_MS, windowMs: FIVE_HOUR_MS },
      weekly: { used: clamp(u.sevenDay.pct), resetsAt: u.sevenDay.resetsAt },
      jev: this.jevPresent ? jevUsage(this.store.spendSince(monthStart(now)), now, JEV_BUDGET_USD) : null,
      fable: u.fable ? { used: clamp(u.fable.pct), resetsAt: u.fable.resetsAt } : null,
      at: u.at,
    };
  }

  /** Latest host sample (memory only, never stored); rides in every snapshot once known. */
  setHost(h: Host): void { this.host = h; }

  snapshot(): SnapshotMsg {
    const m = this.metricsMsg();
    return {
      type: "snapshot", edition: this.edition, jev: this.jevPresent, sessions: this.live().map((s) => toWire(s, this.extraFor(s))), usage: this.usageWire(), metrics: m.metrics, blockedMs: m.blockedMs, blockedWindowMs: m.blockedWindowMs, kpis: m.kpis,
      ...(this.host ? { host: this.host } : {}),
    };
  }

  setProjectsRoot(root: string | null, fsys: FsLike = realFs): void {
    this.root = root;
    this.fsys = fsys;
    this.extraRoots = root ? createRootsOf(this.helperJson, root) : [];
    this.refresh();
    this.projectsKey = JSON.stringify(this.projectsMsg());
  }

  private refresh(): void {
    this.rawScan = this.root ? scanProjects(this.root, this.fsys) : { rootMissing: false, projects: [] };
    this.rawExtra = this.extraRoots.slice(1).map((r) => ({ ...r, ...scanProjects(r.path, this.fsys, { direct: true }) }))
      .map((s) => ({ label: s.label, path: s.path, exists: !s.rootMissing, projects: s.projects.map((p) => ({ ...p, key: `${s.label}:${p.name}` })) }));
    this.applyPicks();
    let t: string | null = null;
    try {
      const v = (JSON.parse(fs.readFileSync(this.helperJson, "utf8")) as { token?: unknown }).token;
      if (typeof v === "string" && /^[0-9a-f]{64}$/.test(v)) t = v;
    } catch { /* no helper actions */ }
    this.token = t;
  }

  /** Rebuild the pick-coloured scans from the cached raw ones (no filesystem access). */
  private applyPicks(): void {
    const picks = this.picks();
    this.scan = { ...this.rawScan, projects: withPicks(this.rawScan.projects, picks) };
    this.extra = this.rawExtra.map((x) => ({ ...x, projects: withPicks(x.projects, picks) }));
  }

  private picks(): Record<string, string> {
    try {
      const v = JSON.parse(this.store.kvGet(COLORS_KEY) ?? "{}") as unknown;
      if (!v || typeof v !== "object" || Array.isArray(v)) return {};
      return Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, c]) => isPaletteColor(c))) as Record<string, string>;
    } catch {
      return {};
    }
  }

  private colorKeyOk(key: string): boolean {
    if ([...this.scan.projects, ...this.extra.flatMap((x) => x.projects)].some((p) => p.key === key)) return true;
    const i = key.indexOf(":");
    if (i < 0) return !!this.root && NAME_RE.test(key);
    return this.extraRoots.slice(1).some((r) => r.label === key.slice(0, i)) && NAME_RE.test(key.slice(i + 1));
  }

  /** Store or clear (null) a project colour pick. False when the key or colour is not allowed. */
  setColor(key: string, color: string | null): boolean {
    if (color !== null && !isPaletteColor(color)) return false;
    if (!this.colorKeyOk(key)) return false;
    const p = this.picks();
    if (color === null) delete p[key]; else p[key] = color;
    this.store.kvSet(COLORS_KEY, JSON.stringify(p));
    this.applyPicks();
    this.refreshProjects();
    for (const s of this.live()) this.push(s);
    return true;
  }

  rescan(): void {
    this.refresh();
    this.refreshProjects();
  }

  private refreshProjects(): void {
    const m = this.projectsMsg();
    const key = JSON.stringify(m);
    if (key === this.projectsKey) return;
    this.projectsKey = key;
    if (m) this.out.projects?.(m);
  }

  projectsMsg(): ProjectsMsg | null {
    if (!this.root) return null;
    const live = this.live().sort((a, b) => b.lastEventAt - a.lastEventAt);
    const closed = this.store.closedSince(this.now() - 7 * DAY_MS).sort((a, b) => b.endedAt - a.endedAt);
    return {
      type: "projects", rootMissing: this.scan.rootMissing, token: this.token,
      projects: [...this.scan.projects.map((p) => ({ p, root: null as string | null })),
        ...this.extra.flatMap((x) => x.projects.map((p) => ({ p, root: x.label })))].map(({ p, root }) => ({
        key: p.key, name: p.name, group: p.group, color: p.color, ...(p.base ? { base: p.base } : {}), ...(p.plain ? { plain: true } : {}),
        folders: p.folders.map((f) => ({
          rel: f.rel, worktree: f.worktree,
          live: live.find((s) => s.folderAbs === f.abs)?.id ?? null,
          restore: closed.filter((r) => r.folder === f.abs).slice(0, 50).map((r) => ({ id: r.id, title: r.title, endedAt: r.endedAt })), root,
        })),
      })),
      createRoots: [{ label: "projects", path: this.fsys.realpath(this.root) ?? this.root, exists: !this.scan.rootMissing },
        ...this.extra.map((x) => ({ label: x.label, path: this.fsys.realpath(x.path) ?? x.path, exists: x.exists }))],
    };
  }

  private extraFor(s: SessionState): { color?: string | null; runnable?: boolean; agentTokens?: Record<string, number>; now?: number } {
    const at = s.folderAbs ?? s.cwd;
    const p = [...this.scan.projects, ...this.extra.flatMap((x) => x.projects)].find((x) => x.folders.some((f) => f.abs === at || f.abs === s.cwd));
    const agentTokens = this.agentTok.get(s.id);
    return { ...(p ? { color: p.color, runnable: !!p.run } : {}), ...(agentTokens ? { agentTokens } : {}), now: this.now() };
  }

  spend(range: Range): Spend {
    return aggregateSpend(this.store.spendSince(rangeStart(range, this.now())));
  }

  doc(sid: string, kind: string): DocResult {
    const s = this.sessions.get(sid);
    if (!s || (kind !== "spec" && kind !== "plan")) return { status: 404 };
    return readDoc(s, kind);
  }

  health(): { ok: true; sessions: number; counts: Record<string, number>; uptimeMs: number } {
    return { ok: true, sessions: this.live().length, counts: { ...this.counts }, uptimeMs: this.now() - this.bootAt };
  }
}
