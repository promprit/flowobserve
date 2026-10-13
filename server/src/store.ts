import path from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import type { SessionState } from "@fo/shared";
import { legacyStageAt, type CallRow, type CycleRow, type Emit, type EscalationRow, type SpendRow, type TransitionRow } from "./reducer";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions(sid TEXT PRIMARY KEY, name TEXT, cwd TEXT, state_json TEXT, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS offsets(file TEXT PRIMARY KEY, byte INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS transitions(sid TEXT, ts INTEGER, from_stage INTEGER, to_stage INTEGER, from_status TEXT, to_status TEXT, cause TEXT);
CREATE INDEX IF NOT EXISTS transitions_ts ON transitions(ts);
CREATE INDEX IF NOT EXISTS transitions_sid_ts ON transitions(sid, ts);
CREATE TABLE IF NOT EXISTS calls(ts INTEGER, sid TEXT, role TEXT, model TEXT, ms INTEGER, ok INTEGER);
CREATE INDEX IF NOT EXISTS calls_ts ON calls(ts);
CREATE TABLE IF NOT EXISTS cycles(sid TEXT, started INTEGER, ended INTEGER, last_stage INTEGER, tasks INTEGER, escalations INTEGER, outcome TEXT, PRIMARY KEY(sid, started));
CREATE TABLE IF NOT EXISTS spend(ts INTEGER, sid TEXT, project TEXT, model TEXT, source TEXT, usd REAL, msg_id TEXT);
CREATE INDEX IF NOT EXISTS spend_ts ON spend(ts);
CREATE TABLE IF NOT EXISTS escalations(ts INTEGER, sid TEXT, task TEXT, from_model TEXT, to_model TEXT);
CREATE INDEX IF NOT EXISTS escalations_ts ON escalations(ts);
CREATE TABLE IF NOT EXISTS kv(key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS jev_seen(h TEXT PRIMARY KEY, ts INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS jev_seen_ts ON jev_seen(ts);
CREATE TABLE IF NOT EXISTS closed(id TEXT PRIMARY KEY, project TEXT, folder TEXT, ended_at INTEGER, title TEXT);
`;

export type ClosedRow = { id: string; project: string; folder: string; endedAt: number; title: string | null };
type Row = Record<string, unknown>;
/** A spend row as stored: Claude transcript rows carry their message id (unique), Jev rows leave it null. */
export type StoredSpend = SpendRow & { msgId?: string | null };
export type StoredEmit = Omit<Emit, "spend"> & { spend: StoredSpend[] };
const bool = (x: unknown) => (x === null || x === undefined ? null : x === 1);
const int = (b: boolean | null) => (b === null ? null : b ? 1 : 0);

export class Store {
  readonly db: DatabaseSync;
  private depth = 0;
  private q: Record<string, StatementSync>;

  constructor(file: string) {
    this.db = new DatabaseSync(file);
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;");
    this.db.exec(SCHEMA);
    // pre-msg_id databases: add the column, then the partial unique index (one row per Claude message id)
    if (!(this.db.prepare("PRAGMA table_info(spend)").all() as Row[]).some((c) => c.name === "msg_id"))
      this.db.exec("ALTER TABLE spend ADD COLUMN msg_id TEXT");
    this.db.exec("CREATE UNIQUE INDEX IF NOT EXISTS spend_msg ON spend(msg_id) WHERE msg_id IS NOT NULL");
    const cycleCols = (this.db.prepare("PRAGMA table_info(cycles)").all() as Row[]).map((c) => c.name);
    for (const col of ["reviews", "plan_tasks"]) if (!cycleCols.includes(col)) this.db.exec(`ALTER TABLE cycles ADD COLUMN ${col} INTEGER`);
    this.db.exec("CREATE UNIQUE INDEX IF NOT EXISTS escalations_key ON escalations(sid, ts, task)");
    const p = (sql: string) => this.db.prepare(sql);
    this.q = {
      getOffset: p("SELECT byte FROM offsets WHERE file = ?"),
      setOffset: p("INSERT INTO offsets(file, byte) VALUES(?, ?) ON CONFLICT(file) DO UPDATE SET byte = excluded.byte"),
      delOffset: p("DELETE FROM offsets WHERE file = ?"),
      saveSession: p(`INSERT INTO sessions(sid, name, cwd, state_json, updated_at) VALUES(?, ?, ?, ?, ?)
        ON CONFLICT(sid) DO UPDATE SET name = excluded.name, cwd = excluded.cwd, state_json = excluded.state_json, updated_at = excluded.updated_at`),
      loadSessions: p("SELECT state_json FROM sessions ORDER BY updated_at"),
      transition: p("INSERT INTO transitions VALUES(?, ?, ?, ?, ?, ?, ?)"),
      call: p("INSERT INTO calls VALUES(?, ?, ?, ?, ?, ?)"),
      cycle: p(`INSERT INTO cycles(sid, started, ended, last_stage, tasks, escalations, outcome, reviews, plan_tasks) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(sid, started) DO UPDATE SET ended = excluded.ended, last_stage = excluded.last_stage, tasks = excluded.tasks,
        escalations = excluded.escalations, outcome = excluded.outcome, reviews = excluded.reviews, plan_tasks = excluded.plan_tasks`),
      escalation: p("INSERT OR IGNORE INTO escalations(ts, sid, task, from_model, to_model) VALUES(?, ?, ?, ?, ?)"),
      escalationsSince: p("SELECT * FROM escalations WHERE ts >= ? ORDER BY ts, rowid"),
      cyclesSince: p("SELECT * FROM cycles WHERE started >= ? OR ended >= ? ORDER BY started"),
      spend: p("INSERT OR IGNORE INTO spend(ts, sid, project, model, source, usd, msg_id) VALUES(?, ?, ?, ?, ?, ?, ?)"),
      transitionsFrom: p(`SELECT rowid AS rid, * FROM transitions WHERE ts >= ?
        UNION ALL SELECT t.rowid AS rid, t.* FROM transitions t
          JOIN (SELECT MAX(rowid) AS r FROM transitions WHERE ts < ? GROUP BY sid) x ON t.rowid = x.r
        ORDER BY sid, ts, rid`),
      callsSince: p("SELECT * FROM calls WHERE ts >= ? ORDER BY ts, rowid"),
      spendSince: p("SELECT * FROM spend WHERE ts >= ? ORDER BY ts, rowid"),
      cycles: p("SELECT * FROM cycles WHERE sid = ? ORDER BY started"),
      closedUpsert: p("INSERT OR REPLACE INTO closed(id, project, folder, ended_at, title) VALUES(?, ?, ?, ?, ?)"),
      closedDelete: p("DELETE FROM closed WHERE id = ?"),
      closedSince: p("SELECT * FROM closed WHERE ended_at >= ? ORDER BY ended_at DESC"),
      closedPrune: p("DELETE FROM closed WHERE ended_at < ?"),
      jevSeen: p("INSERT OR IGNORE INTO jev_seen(h, ts) VALUES(?, ?)"),
      jevSeenPrune: p("DELETE FROM jev_seen WHERE ts < ?"),
      kvGet: p("SELECT value FROM kv WHERE key = ?"),
      kvSet: p("INSERT INTO kv(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"),
    };
  }

  tx<T>(fn: () => T): T {
    if (this.depth > 0) return fn();
    this.depth++;
    this.db.exec("BEGIN");
    try {
      const r = fn();
      this.db.exec("COMMIT");
      return r;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    } finally {
      this.depth--;
    }
  }

  getOffset(file: string): number { return ((this.q.getOffset.get(file) as Row | undefined)?.byte as number) ?? 0; }
  setOffset(file: string, byte: number): void { this.q.setOffset.run(file, byte); }
  deleteOffset(file: string): void { this.q.delOffset.run(file); }
  /** Every stored offset of files directly in dir. */
  offsetsIn(dir: string): Map<string, number> {
    const out = new Map<string, number>();
    for (const r of this.db.prepare("SELECT file, byte FROM offsets").all() as Row[]) {
      const f = r.file as string;
      if (path.dirname(f) === dir) out.set(path.basename(f), r.byte as number);
    }
    return out;
  }

  /** Dirs that have stored read offsets. */
  offsetDirs(): string[] {
    return [...new Set((this.db.prepare("SELECT file FROM offsets").all() as Row[]).map((r) => path.dirname(r.file as string)))];
  }

  /** Marks a Jev line key as read; false when it was read before (from any dir). */
  jevFirstSeen(h: string, ts: number): boolean { return Number(this.q.jevSeen.run(h, ts).changes) > 0; }
  jevSeenPrune(before: number): void { this.q.jevSeenPrune.run(before); }

  saveSession(s: SessionState): void { this.q.saveSession.run(s.id, s.name, s.cwd, JSON.stringify(s), s.lastEventAt); }
  loadSessions(): SessionState[] { return (this.q.loadSessions.all() as Row[]).map((r) => {
    const s = JSON.parse(r.state_json as string) as SessionState;
    return { ...s, log: s.log ?? [], stageAt: s.stageAt ?? legacyStageAt(s), open: s.open ?? {}, wrote: s.wrote ?? null, fromClear: s.fromClear ?? false, ctx: s.ctx ?? null, handoffAt: s.handoffAt ?? null, worktree: s.worktree ?? null, title: s.title ?? null, docs: s.docs ?? { spec: 0, plan: 0, at: null }, reviewersDue: s.reviewersDue ?? 0, pendingReview: s.pendingReview ?? [], reviewSubs: s.reviewSubs ?? {}, term: s.term ?? null, prompts: s.prompts ?? 0, lastEnd: s.lastEnd ?? null, specPath: s.specPath ?? null, planPath: s.planPath ?? null, ready: s.ready ?? null, reviewDoneAt: s.reviewDoneAt ?? null, ranAt: s.ranAt ?? null, tryFound: s.tryFound ?? false, folderAbs: s.folderAbs ?? s.cwd, untaggedDone: s.untaggedDone ?? Array.from({ length: s.tasksDone ?? 0 }, (_, i) => "legacy" + i), doneTasks: s.doneTasks ?? [] };
  });
  }

  insert(e: StoredEmit): void {
    for (const t of e.transitions) this.q.transition.run(t.sid, t.ts, t.fromStage, t.toStage, t.fromStatus, t.toStatus, t.cause);
    for (const c of e.calls) this.q.call.run(c.ts, c.sid, c.role, c.model, c.ms, int(c.ok));
    for (const c of e.cycles) this.q.cycle.run(c.sid, c.started, c.ended, c.lastStage, c.tasks, c.escalations, c.outcome, c.reviews ?? null, c.planTasks ?? null);
    for (const x of e.escalations ?? []) this.q.escalation.run(x.ts, x.sid, x.task, x.from, x.to);
    for (const s of e.spend) this.q.spend.run(s.ts, s.sid, s.project, s.model, s.source, s.usd, s.msgId ?? null);
  }

  transitionsFrom(from: number): TransitionRow[] {
    return (this.q.transitionsFrom.all(from, from) as Row[]).map((r) => ({
      sid: r.sid as string, ts: r.ts as number, fromStage: r.from_stage as number, toStage: r.to_stage as number,
      fromStatus: r.from_status as TransitionRow["fromStatus"], toStatus: r.to_status as TransitionRow["toStatus"], cause: r.cause as string,
    }));
  }

  callsSince(from: number): CallRow[] {
    return (this.q.callsSince.all(from) as Row[]).map((r) => ({
      ts: r.ts as number, sid: r.sid as string, role: r.role as CallRow["role"], model: r.model as string,
      ms: (r.ms as number | null) ?? null, ok: bool(r.ok),
    }));
  }

  spendSince(from: number): SpendRow[] {
    return (this.q.spendSince.all(from) as Row[]).map((r) => ({
      ts: r.ts as number, sid: (r.sid as string | null) ?? null, project: r.project as string, model: r.model as string,
      source: r.source as SpendRow["source"], usd: r.usd as number,
    }));
  }

  private cycleOf(r: Row): CycleRow {
    return {
      sid: r.sid as string, started: r.started as number, ended: (r.ended as number | null) ?? null, lastStage: r.last_stage as number,
      tasks: r.tasks as number, escalations: r.escalations as number, reviews: (r.reviews as number | null) ?? null, planTasks: (r.plan_tasks as number | null) ?? null,
      outcome: (r.outcome as CycleRow["outcome"]) ?? null,
    };
  }

  cycles(sid: string): CycleRow[] { return (this.q.cycles.all(sid) as Row[]).map((r) => this.cycleOf(r)); }
  cyclesSince(from: number): CycleRow[] { return (this.q.cyclesSince.all(from, from) as Row[]).map((r) => this.cycleOf(r)); }

  escalationsSince(from: number): EscalationRow[] {
    return (this.q.escalationsSince.all(from) as Row[]).map((r) => ({
      ts: r.ts as number, sid: r.sid as string, task: r.task as string,
      from: r.from_model as EscalationRow["from"], to: r.to_model as EscalationRow["to"],
    }));
  }

  closedUpsert(r: ClosedRow): void { this.q.closedUpsert.run(r.id, r.project, r.folder, r.endedAt, r.title); }
  closedDelete(id: string): void { this.q.closedDelete.run(id); }
  closedSince(from: number): ClosedRow[] {
    return (this.q.closedSince.all(from) as Row[]).map((r) => ({
      id: r.id as string, project: r.project as string, folder: r.folder as string, endedAt: r.ended_at as number, title: (r.title as string | null) ?? null,
    }));
  }
  closedPrune(before: number): void { this.q.closedPrune.run(before); }

  kvGet(key: string): string | null { return ((this.q.kvGet.get(key) as Row | undefined)?.value as string) ?? null; }
  kvSet(key: string, value: string): void { this.q.kvSet.run(key, value); }
}
