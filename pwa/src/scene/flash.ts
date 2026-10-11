/** Spec §11: one ring flash when Jev actually stopped something. Pure. */
export const FLASH_MS = 1200;
/** A flash older than this (reconnect, sleeping tab) is history, not news. */
export const FLASH_STALE_MS = 5000;

export function flashLit(ageMs: number, reduce: boolean): number {
  if (ageMs < 0 || ageMs >= FLASH_MS) return 0;
  return reduce ? 0.5 : 0.9 * Math.sin((Math.PI * ageMs) / FLASH_MS);
}

/** True only for a flash newer than one already seen; the first sighting of a session just records it. */
export function flashSeen(seen: Map<string, number>, id: string, at: number | null | undefined, now: number): boolean {
  const was = seen.get(id);
  if (at == null) { if (was === undefined) seen.set(id, 0); return false; }
  if (was !== undefined && at <= was) return false;
  seen.set(id, at);
  return was !== undefined && now - at <= FLASH_STALE_MS;
}
