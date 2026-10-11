import type { Session } from "@fo/shared";
import { ATTN, I3 } from "./config";
import { onStatus } from "./pager";
import { type CSession, changed, now, store } from "./state";

let nextOrder = 0;

export function pushLog(s: CSession): void {
  if (!s.say) return;
  const l = s.log[s.log.length - 1];
  if (!l || l.text !== s.say.text) {
    s.log.push(s.say);
    delete s.seeded;
    if (s.log.length > 40) s.log.shift();
  }
}

export function say(s: CSession, text: string): void {
  s.say = { t: now(), text };
  pushLog(s);
  s.lastEventAt = now();
  store.lastUpdate = now();
  changed();
}

export function setS(s: CSession, patch: Partial<CSession>): void {
  const pst = s.status, pstage = s.stage;
  Object.assign(s, patch);
  if (s.status !== pst || s.stage !== pstage) s.since = now();
  s.lastEventAt = now();
  store.lastUpdate = now();
  if (s.status !== pst) onStatus(s, pst);
  changed();
}

/** Seed an empty client log from the wire log; otherwise append wire lines newer than the last entry (reconnect gap fill). */
function seedLog(s: CSession, x: Session): void {
  if (!x.log?.length) return;
  if (s.log.length) {
    const last = s.log[s.log.length - 1];
    for (const l of x.log) {
      const e = s.log[s.log.length - 1];
      if (l.t > last.t && l.text !== e.text) { s.log.push({ t: l.t, text: l.text }); delete s.seeded; }
    }
    if (s.log.length > 40) s.log = s.log.slice(-40);
    return;
  }
  s.log = x.log.map((l) => ({ t: l.t, text: l.text })).slice(-40);
  s.seeded = true;
}

/** Server session → client session (live data keeps the server's since/lastEventAt). */
export function upsert(x: Session, i: number): void {
  const s = store.sessions.get(x.id);
  if (!s) {
    const n: CSession = { ...x, builders: x.builders ?? I3(), order: Math.max(i, nextOrder++), log: [], seen: false, washAt: 0 };
    seedLog(n, x);
    store.sessions.set(x.id, n);
    pushLog(n);
    if (ATTN[n.status]) onStatus(n, "active");
  } else {
    const pst = s.status;
    const { log: _wire, ...rest } = x;
    Object.assign(s, rest);
    seedLog(s, x);
    pushLog(s);
    if (s.status !== pst) onStatus(s, pst);
  }
  changed();
}

export function applySnapshot(list: Session[]): void {
  const seen = new Set<string>();
  list.forEach((x, i) => { upsert(x, i); seen.add(x.id); });
  for (const k of [...store.sessions.keys()]) if (!seen.has(k)) store.sessions.delete(k);
  changed();
}
