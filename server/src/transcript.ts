import fs from "node:fs";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import type { Ctx } from "@fo/shared";

/** Read-only transcript reader (spec §9.1). Numbers only: id, model, usage of assistant records. Text is never kept. */
export interface TUsage { input: number; output: number; write5m: number; write1h: number; read: number }
/** ts = the record's own top-level `timestamp` in ms, or null when missing/invalid. */
export interface TMsg { id: string; model: string; usage: TUsage; ts: number | null }
/** One message found during a poll, in file order. agent = subagent id from `subagents/agent-<id>.jsonl`; null for the main file. */
export interface TItem { sid: string; m: TMsg; main: boolean; agent?: string | null }
export const AGENT_FILE = /(?:^|[\\/])agent-([A-Za-z0-9]+)\.jsonl$/;
export const MAX_READ = 4 << 20;
const BIG = 200_000, HUGE = 1_000_000, WARN_DEFAULT = 0.55;

type Obj = Record<string, unknown>;
const obj = (x: unknown): Obj => (x !== null && typeof x === "object" && !Array.isArray(x) ? (x as Obj) : {});
const num = (x: unknown): number => (typeof x === "number" && Number.isFinite(x) && x > 0 ? x : 0);

export function parseTranscriptLine(raw: string): TMsg | null {
  if (!raw.includes('"usage"')) return null;
  let r: Obj;
  try { r = obj(JSON.parse(raw)); } catch { return null; }
  if (r.type !== "assistant") return null;
  const m = obj(r.message), u = obj(m.usage), cc = obj(u.cache_creation);
  if (typeof m.id !== "string" || !m.id || !Object.keys(u).length) return null;
  const writes = num(u.cache_creation_input_tokens), w1h = Math.min(writes, num(cc.ephemeral_1h_input_tokens));
  const usage: TUsage = { input: num(u.input_tokens), output: num(u.output_tokens), write5m: writes - w1h, write1h: w1h, read: num(u.cache_read_input_tokens) };
  if (!usage.input && !usage.output && !writes && !usage.read) return null; // synthetic notices
  const t = typeof r.timestamp === "string" ? Date.parse(r.timestamp) : NaN;
  return { id: m.id, model: typeof m.model === "string" ? m.model : "", usage, ts: Number.isFinite(t) ? t : null };
}

/** Remote Control marks (spec §7). Ids and text are read only to match and are never returned. */
export type RcMark = { kind: "takeover"; ts: number } | { kind: "bridge" };
const RC_PREFIX = "Remote Control disconnected";
export function parseRcLine(raw: string): RcMark | null {
  if (!raw.includes('"bridge-session"') && !raw.includes(RC_PREFIX)) return null;
  let r: Obj;
  try { r = obj(JSON.parse(raw)); } catch { return null; }
  if (r.type === "bridge-session") return typeof r.bridgeSessionId === "string" && r.bridgeSessionId ? { kind: "bridge" } : null;
  if (r.type !== "system" || r.subtype !== "informational" || typeof r.content !== "string" || !r.content.startsWith(RC_PREFIX)) return null;
  const t = typeof r.timestamp === "string" ? Date.parse(r.timestamp) : NaN;
  return Number.isFinite(t) ? { kind: "takeover", ts: t } : null;
}

export const ctxTokens = (u: TUsage): number => u.input + u.write5m + u.write1h + u.read;

/** True when the model id runs a 1M window by default (Fable/Mythos, Opus/Sonnet 4.6+). Ids may carry a date suffix. */
export function millionModel(model: string): boolean {
  if (/fable|mythos/.test(model)) return true;
  // Versions are 1-2 digits so a date is never read as one: claude-sonnet-4-20250514 is 4.0, claude-3-opus-20240229 has no match.
  const m = /(?:opus|sonnet)-(\d{1,2})(?!\d)(?:-(\d{1,2})(?!\d))?/.exec(model);
  if (!m) return false; // Haiku and unknown ids: 200k, like Jev; the > 200k rule still corrects a miss
  const major = Number(m[1]), minor = Number(m[2] ?? 0);
  return major > 4 || (major === 4 && minor >= 6);
}

export function windowFor(model: string, biggest: number, env?: string): number {
  const e = Number(env);
  if (env && Number.isInteger(e) && e > 0) return e;
  return model.includes("[1m]") || millionModel(model) || biggest > BIG ? HUGE : BIG;
}

export function ctxOf(tokens: number, model: string, biggest: number, warnPct: number, env?: string): Ctx {
  const window = windowFor(model, Math.max(biggest, tokens), env);
  const pct = Math.min(1, tokens / window);
  const eps = 1e-9; // 0.55 + 0.05 is 0.6000000000000001 in floating point
  return { pct, tokens, window, level: pct >= warnPct + 0.05 - eps ? "crit" : pct >= warnPct - eps ? "warn" : "ok" };
}

/** thresholds.json context.warn_pct; anything missing or out of (0, 1) → Jev's default 0.55. */
export function warnPctFrom(text: string | null): number {
  try {
    const v = obj(obj(JSON.parse(text ?? "")).context).warn_pct;
    return typeof v === "number" && v > 0 && v < 1 ? v : WARN_DEFAULT;
  } catch { return WARN_DEFAULT; }
}

interface FileState { offset: number; carry: string; dec: StringDecoder }
interface Watch { path: string; files: Map<string, FileState>; seen: Set<string>; metas: Set<string> }
const META_FILE = /^agent-([A-Za-z0-9]+)\.meta\.json$/;
export type AgentMeta = { agentId: string; useId: string };

export class TranscriptTailer {
  private w = new Map<string, Watch>();
  private roots: string[] = [];
  private maxRead: number;
  private onRc?: (sid: string, r: RcMark) => void;
  private onMeta?: (sid: string, m: AgentMeta) => void;
  /** onBatch gets every new message of one poll at once (so the consumer can write them in one transaction). */
  constructor(root: string | string[], private onBatch: (items: TItem[]) => void, opts: { maxRead?: number; onRc?: (sid: string, r: RcMark) => void; onMeta?: (sid: string, m: AgentMeta) => void } = {}) {
    this.onRc = opts.onRc;
    this.onMeta = opts.onMeta;
    this.maxRead = opts.maxRead ?? MAX_READ;
    this.setRoots(Array.isArray(root) ? root : [root]);
  }

  /** Roots are realpathed now; a root that does not exist yet is kept as given. */
  setRoots(roots: string[]): void {
    this.roots = roots.map((r) => { try { return fs.realpathSync(r); } catch { return path.resolve(r); } });
  }

  /** Accept only a real .jsonl path under one of the roots (spec §9.1 path guard). */
  watch(sid: string, p: string): "ok" | "same" | "rejected" {
    let real: string;
    try { real = fs.realpathSync(p); } catch { return "rejected"; }
    if (!real.endsWith(".jsonl") || !this.roots.some((r) => real.startsWith(r + path.sep))) return "rejected";
    if (this.w.get(sid)?.path === real) return "same";
    this.w.set(sid, { path: real, files: new Map(), seen: new Set(), metas: new Set() });
    return "ok";
  }

  forget(sid: string): void { this.w.delete(sid); }

  poll(): void {
    const out: TItem[] = [];
    const rcs: { sid: string; r: RcMark }[] = [];
    const metas: { sid: string; m: AgentMeta }[] = [];
    for (const [sid, w] of this.w) {
      this.read(sid, w, w.path, true, out, rcs);
      const dir = path.join(w.path.slice(0, -".jsonl".length), "subagents");
      let all: string[] = [];
      try { all = fs.readdirSync(dir).sort(); } catch { /* no subagents yet */ }
      for (const f of all) if (f.endsWith(".jsonl")) this.read(sid, w, path.join(dir, f), false, out, rcs);
      for (const f of all) if (!w.metas.has(f)) this.readMeta(sid, w, dir, f, metas);
    }
    if (out.length) this.onBatch(out);
    for (const x of rcs) this.onRc?.(x.sid, x.r);
    for (const x of metas) this.onMeta?.(x.sid, x.m);
  }

  /** Keeps only toolUseId and the agent id from the file name; other fields (description, prompt) are never held. */
  private readMeta(sid: string, w: Watch, dir: string, f: string, metas: { sid: string; m: AgentMeta }[]): void {
    const id = META_FILE.exec(f)?.[1];
    if (!id) return;
    try {
      const u = obj(JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"))).toolUseId;
      w.metas.add(f); // parsed: read once, whether or not it carries a usable id
      if (typeof u !== "string" || !u || u.length > 64) return;
      metas.push({ sid, m: { agentId: id, useId: u } });
    } catch { /* partial or unreadable: retry next poll */ }
  }

  private read(sid: string, w: Watch, file: string, main: boolean, out: TItem[], rcs: { sid: string; r: RcMark }[]): void {
    const st = w.files.get(file) ?? { offset: 0, carry: "", dec: new StringDecoder("utf8") };
    w.files.set(file, st);
    let fd: number | null = null;
    try {
      const size = fs.statSync(file).size;
      if (size < st.offset) { st.offset = 0; st.carry = ""; st.dec = new StringDecoder("utf8"); }
      if (size === st.offset) return;
      const len = Math.min(size - st.offset, this.maxRead), buf = Buffer.alloc(len);
      fd = fs.openSync(file, "r");
      fs.readSync(fd, buf, 0, len, st.offset);
      st.offset += len;
      const lines = (st.carry + st.dec.write(buf)).split("\n"); // decoder holds a multi-byte char split at the chunk edge
      st.carry = lines.pop() ?? "";
      for (const l of lines) {
        if (main) { const rc = parseRcLine(l); if (rc) { rcs.push({ sid, r: rc }); continue; } }
        const m = parseTranscriptLine(l);
        if (!m || w.seen.has(m.id)) continue;
        w.seen.add(m.id);
        out.push({ sid, m, main, agent: main ? null : AGENT_FILE.exec(file)?.[1] ?? null });
      }
    } catch { /* missing or unreadable: try again next poll */ }
    finally { if (fd !== null) fs.closeSync(fd); }
  }
}
