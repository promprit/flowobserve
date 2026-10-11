import type { Msg } from "@fo/shared";
import { BACKOFF, STALE_MS } from "./config";
import { type Link, changed, now, store } from "./state";
import { applySnapshot, upsert } from "./store";

/** null = run the simulator (?demo). In production ?src is honoured only on the serving host. */
export function srcFrom(loc: { protocol: string; host: string }, qs: URLSearchParams, prod: boolean = !import.meta.env.DEV): string | null {
  if (qs.has("demo")) return null;
  const src = qs.get("src");
  if (src) {
    if (!prod) return src;
    try { if (new URL(src).host === loc.host) return src; } catch { /* fall back to the default */ }
  }
  return `${loc.protocol === "https:" ? "wss" : "ws"}://${loc.host}/ws`;
}

/** null when src is not a URL (no spend drawer data). */
export function spendBase(src: string): string | null {
  try {
    const u = new URL(src);
    return `${u.protocol === "wss:" || u.protocol === "https:" ? "https" : "http"}://${u.host}`;
  } catch { return null; }
}

export function linkState(t: number, l: { open: boolean; lastMsgAt: number; downAt: number | null }): Link {
  if (l.open && t - l.lastMsgAt <= STALE_MS) return "live";
  const since = l.open ? Math.max(l.lastMsgAt + STALE_MS, l.downAt ?? 0) : (l.downAt ?? l.lastMsgAt);
  return t - since >= STALE_MS ? "offline" : "stale";
}

const lk = { open: false, lastMsgAt: 0, downAt: null as number | null, tries: 0 };

export function linkTick(): void {
  const l = linkState(now(), lk);
  if (l !== store.link) { store.link = l; changed(); }
}

const TYPES = new Set(["snapshot", "session", "usage", "metrics", "hb", "host", "projects"]);
let validate: ((m: unknown) => boolean) | null = null;

/** Dev builds only: check every message against the zod wire schema. */
export async function enableValidation(): Promise<void> {
  const { MsgZ } = await import("@fo/shared/wire");
  validate = (m) => {
    const r = MsgZ.safeParse(m);
    if (!r.success) console.warn("flowobserve: message breaks the wire contract", r.error.issues);
    return r.success;
  };
}

export function parse(data: string): Msg | null {
  let m: unknown;
  try { m = JSON.parse(data); } catch { return null; }
  if (!m || typeof m !== "object" || !TYPES.has((m as { type?: string }).type ?? "")) return null;
  if (validate && !validate(m)) return null;
  return m as Msg;
}

export function ingest(m: Msg): void {
  lk.lastMsgAt = now(); lk.downAt = null; lk.tries = 0; lk.open = true;
  store.lastUpdate = now();
  switch (m.type) {
    case "hb": return;
    case "snapshot":
      store.usage = m.usage; store.metrics = m.metrics; store.kpis = m.kpis ?? []; store.host = m.host ?? null; store.edition = m.edition ?? "both"; store.jev = m.jev !== false;
      store.blockedMs = m.blockedMs; store.blockedWindowMs = m.blockedWindowMs;
      applySnapshot(m.sessions);
      break;
    case "session": upsert(m.session, store.sessions.size); break;
    case "usage": store.usage = m.usage; break;
    case "host": store.host = m.host; break;
    case "projects": store.projects = m.projects; store.rootMissing = m.rootMissing; store.helperToken = m.token; store.createRoots = m.createRoots; break;
    case "metrics":
      store.metrics = m.metrics; store.kpis = m.kpis ?? []; store.blockedMs = m.blockedMs; store.blockedWindowMs = m.blockedWindowMs;
      break;
  }
  changed();
}

interface Sock { onopen: ((e: unknown) => void) | null; onmessage: ((e: { data: unknown }) => void) | null; onerror: ((e: unknown) => void) | null; close(): void }
interface WsSock extends Sock { onclose: ((e: unknown) => void) | null }
export interface Env {
  WebSocket: new (url: string) => WsSock;
  EventSource: new (url: string) => Sock;
  setTimeout(f: () => void, ms: number): unknown;
  now(): number;
}
const browserEnv = (): Env => ({
  WebSocket: WebSocket as unknown as Env["WebSocket"],
  EventSource: EventSource as unknown as Env["EventSource"],
  setTimeout: (f, ms) => setTimeout(f, ms),
  now: () => Date.now(),
});

/** Connects and keeps reconnecting (1 s, 2 s, 4 s, 8 s, 8 s …). Returns stop(). */
export function connect(src: string, env: Env = browserEnv()): () => void {
  let stopped = false;
  let closeCur = () => {};
  lk.open = false; lk.downAt = env.now(); lk.tries = 0;
  const attempt = () => {
    if (stopped) return;
    let failed = false;
    const fail = () => {
      if (failed || stopped) return;
      failed = true;
      lk.open = false;
      lk.downAt ??= env.now();
      const d = BACKOFF[Math.min(lk.tries++, BACKOFF.length - 1)];
      store.retryAt = env.now() + d;
      changed();
      env.setTimeout(attempt, d);
    };
    const onMsg = (data: unknown) => { const m = parse(String(data)); if (m) ingest(m); };
    try {
      if (/^wss?:/.test(src)) {
        const ws = new env.WebSocket(src);
        ws.onopen = () => { lk.open = true; };
        ws.onmessage = (e) => onMsg(e.data);
        ws.onclose = fail;
        ws.onerror = fail;
        closeCur = () => ws.close();
      } else {
        const es = new env.EventSource(src);
        es.onopen = () => { lk.open = true; };
        es.onmessage = (e) => onMsg(e.data);
        es.onerror = () => { es.close(); fail(); };
        closeCur = () => es.close();
      }
    } catch { fail(); }
  };
  attempt();
  return () => { stopped = true; closeCur(); };
}
