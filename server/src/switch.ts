import type { ClaudeUsage } from "./usagecache";

/** from must be this fresh: a reading older than 10 min may already be stale. */
export const FROM_FRESH_MS = 600_000;
/** to must be this fresh to be "known"; older readings (and none) count as unknown and are offered last. */
export const TO_FRESH_MS = 21_600_000;

export interface SwitchRow { label: string; used: number | null; weekly: number | null; at: number | null }
export interface SwitchHint { from: string; to: string; used: number }

/** 5h use (0..1) right now: 0 once its window has reset. */
export function usedNow(u: ClaudeUsage, now: number): number {
  return u.fiveHour.resetsAt <= now ? 0 : Math.min(1, Math.max(0, u.fiveHour.pct / 100));
}

/** Weekly use (0..1) right now: 0 once its window has reset, null when there is no weekly limit. */
export function weeklyNow(u: ClaudeUsage, now: number): number | null {
  return !u.sevenDay ? null : u.sevenDay.resetsAt <= now ? 0 : Math.min(1, Math.max(0, u.sevenDay.pct / 100));
}

/** Spec §5. rows[0] is the primary account (the one cl prefers) and the only possible from; the rest are in display order. threshold = FO_SWITCH_AT (1 = off). Pure. */
export function switchHint(rows: SwitchRow[], now: number, threshold: number): SwitchHint | null {
  if (!(threshold < 1)) return null;
  const fresh = (r: SwitchRow, ms: number) => r.used !== null && r.at !== null && now - r.at < ms;
  const [from, ...others] = rows;
  if (!from || !fresh(from, FROM_FRESH_MS)) return null;
  const used = Math.max(from.used! >= threshold ? from.used! : 0, (from.weekly ?? 0) >= threshold ? from.weekly! : 0);
  if (!used) return null;
  const known = others.filter((r) => fresh(r, TO_FRESH_MS) && r.used! < threshold && (r.weekly ?? 0) < threshold).sort((a, b) => a.used! - b.used!)[0];
  const to = known ?? others.find((r) => !fresh(r, TO_FRESH_MS));
  return to ? { from: from.label, to: to.label, used } : null;
}
