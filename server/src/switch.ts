import type { ClaudeUsage } from "./usagecache";

/** from must be this fresh: a reading older than 10 min may already be stale. */
export const FROM_FRESH_MS = 600_000;
/** to must be this fresh to be "known"; older readings (and none) count as unknown and are offered last. */
export const TO_FRESH_MS = 21_600_000;

export interface SwitchRow { label: string; used: number | null; at: number | null }
export interface SwitchHint { from: string; to: string; used: number }

/** 5h use (0..1) right now: 0 once its window has reset. */
export function usedNow(u: ClaudeUsage, now: number): number {
  return u.fiveHour.resetsAt <= now ? 0 : Math.min(1, Math.max(0, u.fiveHour.pct / 100));
}

/** Spec §5. rows in display order; threshold = FO_SWITCH_AT (1 = off). Pure. */
export function switchHint(rows: SwitchRow[], now: number, threshold: number): SwitchHint | null {
  if (!(threshold < 1)) return null;
  const fresh = (r: SwitchRow, ms: number) => r.used !== null && r.at !== null && now - r.at < ms;
  const from = rows.filter((r) => fresh(r, FROM_FRESH_MS) && r.used! >= threshold).sort((a, b) => b.used! - a.used!)[0];
  if (!from) return null;
  const others = rows.filter((r) => r !== from);
  const known = others.filter((r) => fresh(r, TO_FRESH_MS) && r.used! < threshold).sort((a, b) => a.used! - b.used!)[0];
  const to = known ?? others.find((r) => !fresh(r, TO_FRESH_MS));
  return to ? { from: from.label, to: to.label, used: from.used! } : null;
}
