import { BUILD_RE, INTERROGATE_CMD_RE, MERGE_RE, NOT_MERGE_RE, TEST_RE } from "./ingest";

/** Fixture scrubber: keeps only what ingest/engine read, maps paths and ids, replaces free text. Allowlist, so a new field is dropped, not leaked. */
export interface ScrubOpts { maps: Array<[from: string, to: string]> }

type Obj = Record<string, unknown>;
const obj = (x: unknown): Obj => (x !== null && typeof x === "object" && !Array.isArray(x) ? (x as Obj) : {});
const has = (o: Obj, k: string) => Object.prototype.hasOwnProperty.call(o, k);

const KEEP = ["agent_id", "agent_type", "tool_name", "tool_use_id", "source", "notification_type", "action", "ok"];
const KEEP_INPUT = ["skill", "subagent_type", "model", "from_model", "to_model", "role", "tier", "round"];
const ID_KEYS = new Set(["session_id", "agent_id", "tool_use_id"]);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i; // only real ids are safe to substitute inside paths
const prim = (x: unknown) => x === null || typeof x === "string" || typeof x === "number" || typeof x === "boolean";
const int = (x: unknown) => (Number.isInteger(x) ? x : undefined);
const limit = (x: unknown): Obj | undefined => {
  const o = obj(x), r: Obj = {};
  for (const k of ["used_percentage", "resets_at"]) if (typeof o[k] === "number") r[k] = o[k];
  return Object.keys(r).length ? r : undefined;
};

export function canonCommand(c: string): string {
  const out: string[] = [];
  if (TEST_RE.test(c)) out.push("pnpm test");
  else if (BUILD_RE.test(c)) out.push("pnpm build");
  if (MERGE_RE.test(c) && !NOT_MERGE_RE.test(c)) out.push("git merge topic");
  if (INTERROGATE_CMD_RE.test(c)) out.push("cat ~/.claude/skills/interrogate/SKILL.md");
  return out.join(" && ") || "true";
}

export class Scrubber {
  private ids = new Map<string, string>();
  private texts = new Map<string, Map<string, string>>();
  private maps: Array<[string, string]>;

  constructor(opts: ScrubOpts) {
    const enc = (p: string) => p.replace(/[\\/.:]/g, "-");
    // Each path map also applies in Claude's encoded project-folder form (-Volumes-Disk-...).
    this.maps = opts.maps.flatMap(([f, t]) => [[f, t], [enc(f), enc(t)]] as Array<[string, string]>);
  }

  private id(x: string): string {
    if (!x) return x; // helper lines carry sid "": the engine pairs them by cwd
    if (!this.ids.has(x)) this.ids.set(x, `00000000-0000-4000-8000-${String(this.ids.size + 1).padStart(12, "0")}`);
    return this.ids.get(x)!;
  }

  /** iTerm2 session ids look like w0t1p2:<uuid>; keep the pane prefix (the jump link checks the shape), map the uuid. */
  private pane(x: string): string {
    const m = /^(w\d+t\d+p\d+:)(.+)$/.exec(x);
    return m ? m[1] + this.id(m[2]) : this.id(x);
  }

  private text(kind: string, x: string): string {
    if (!x) return x;
    const m = this.texts.get(kind) ?? new Map<string, string>();
    this.texts.set(kind, m);
    if (!m.has(x)) m.set(x, `${kind}-${m.size + 1}`);
    return m.get(x)!;
  }

  private path(p: string): string {
    let s = p;
    for (const [f, t] of this.maps) s = s.split(f).join(t);
    s = s.replace(/\/Users\/(?!dev(?:\/|$))[^/"]+(?=\/|$)/g, "/Users/dev").replace(/-Users-(?!dev-)[^-/"]+-/g, "-Users-dev-");
    s = s.replace(/\/home\/(?!dev(?:\/|$))[^/"]+(?=\/|$)/g, "/home/dev").replace(/(^|\/)-home-(?!dev-)[^-/"]+-/g, "$1-home-dev-");
    s = s.replace(/^([A-Za-z]:\\Users\\)(?!dev(?:\\|$))[^\\"]+(?=\\|$)/, "$1dev");
    for (const [real, fake] of this.ids) if (UUID_RE.test(real)) s = s.split(real).join(fake);
    return s;
  }

  line(raw: string): string {
    let x: unknown;
    try { x = JSON.parse(raw); } catch { return "malformed"; } // text dropped; replay still counts the line
    const o = obj(x), p = obj(o.payload), ti = obj(p.tool_input), fo = obj(p.fo);
    const sid = typeof o.sid === "string" ? this.id(o.sid) : o.sid;
    const q: Obj = {};
    if (typeof p.session_id === "string") q.session_id = this.id(p.session_id);
    for (const k of KEEP) if (has(p, k)) if (prim(p[k])) q[k] = ID_KEYS.has(k) && typeof p[k] === "string" ? this.id(p[k] as string) : p[k];
    if (o.event === "SessionEnd" && typeof p.reason === "string") q.reason = p.reason; // a short enum (clear, logout, ...)
    if (typeof p.session_title === "string") q.session_title = this.text("title", p.session_title);
    if (typeof p.message === "string") q.message = this.text("text", p.message);
    if (typeof p.transcript_path === "string") q.transcript_path = this.path(p.transcript_path);
    if (has(p, "cost")) q.cost = { total_cost_usd: obj(p.cost).total_cost_usd };
    if (has(p, "model")) q.model = { id: obj(p.model).id };
    if (has(p, "rate_limits")) {
      const rl = obj(p.rate_limits), r: Obj = {};
      for (const k of ["five_hour", "seven_day"]) { const v = limit(rl[k]); if (v) r[k] = v; }
      q.rate_limits = r;
    }
    if (has(p, "tool_input")) {
      const t: Obj = {};
      for (const k of KEEP_INPUT) if (has(ti, k) && prim(ti[k])) t[k] = ti[k];
      if (typeof ti.file_path === "string") t.file_path = this.path(ti.file_path);
      if (typeof ti.command === "string") t.command = canonCommand(ti.command);
      if (typeof ti.description === "string") t.description = this.text("task", ti.description.trim().slice(0, 160));
      if (typeof ti.task === "string") t.task = this.text("task", ti.task.trim().slice(0, 160));
      if (typeof ti.reason === "string") t.reason = /^skip-up/i.test(ti.reason.trim()) ? "skip-up" : "";
      if (Array.isArray(ti.questions)) t.questions = [{ question: this.text("text", String(obj(ti.questions[0]).question ?? "")) }];
      q.tool_input = t;
    }
    if (has(p, "tool_response")) q.tool_response = { interrupted: obj(p.tool_response).interrupted };
    if (has(p, "fo")) {
      const f: Obj = {};
      if (has(fo, "tests")) { const t = obj(fo.tests); f.tests = { passed: int(t.passed), failed: int(t.failed) }; }
      if (fo.result === "pass" || fo.result === "fail") f.result = fo.result;
      if (has(fo, "planTasks")) f.planTasks = int(fo.planTasks);
      if (typeof fo.say === "string") f.say = this.text("text", fo.say);
      q.fo = f;
    }
    const term = obj(o.term);
    const out: Obj = { v: o.v, ts: o.ts, src: o.src, sid, cwd: typeof o.cwd === "string" ? this.path(o.cwd) : o.cwd, event: o.event, payload: q, truncated: o.truncated };
    if (has(o, "term")) out.term = { entry: typeof term.entry === "string" ? term.entry : null, program: typeof term.program === "string" ? term.program : null, iterm: typeof term.iterm === "string" ? this.pane(term.iterm) : null };
    if (typeof o.acct === "string") out.acct = o.acct.startsWith("~") ? o.acct : this.path(o.acct);
    return JSON.stringify(out);
  }
}
