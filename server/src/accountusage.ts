import type { Usage } from "@fo/shared";
import { DEFAULT_ACCT, canonAcct } from "./accounts";
import { FIVE_HOUR_MS } from "./config";
import type { ClaudeUsage } from "./usagecache";

type Obj = Record<string, unknown>;
const obj = (x: unknown): Obj => (x && typeof x === "object" && !Array.isArray(x) ? (x as Obj) : {});
const num = (x: unknown) => typeof x === "number" && Number.isFinite(x);
const isLimit = (x: unknown) => num(obj(x).pct) && num(obj(x).resetsAt);
const isUsage = (x: unknown): x is ClaudeUsage => isLimit(obj(x).fiveHour) && isLimit(obj(x).sevenDay) && num(obj(x).at);

/** kv "usage" → acct → reading. A value from before accounts (one reading) is the default account's. */
export function usageFromStore(text: string | null): Map<string, ClaudeUsage> {
  const out = new Map<string, ClaudeUsage>();
  if (!text) return out;
  let v: unknown;
  try { v = JSON.parse(text); } catch { return out; }
  if (isUsage(v)) { out.set(DEFAULT_ACCT, v); return out; }
  for (const [k, x] of Object.entries(obj(v))) {
    const a = canonAcct(k);
    if (a && isUsage(x)) out.set(a, x);
  }
  return out;
}

export const usageToStore = (m: Map<string, ClaudeUsage>): string => JSON.stringify(Object.fromEntries(m));

const clamp = (x: number) => Math.min(1, Math.max(0, x / 100));

/** One reading's 5h and weekly meters, as the wire carries them. */
export function limitsWire(u: ClaudeUsage): Pick<Usage, "session" | "weekly"> {
  return {
    session: { used: clamp(u.fiveHour.pct), startedAt: u.fiveHour.resetsAt - FIVE_HOUR_MS, windowMs: FIVE_HOUR_MS },
    weekly: { used: clamp(u.sevenDay.pct), resetsAt: u.sevenDay.resetsAt },
  };
}
