/** Spec §4 portrait pager. Pure. Page unit = one session; order = project order, then start; never reorders while a session lives. */
import { byStart, keyOf, type LayoutSession } from "./layout";

/** Project rank = first time the board saw that project; never reassigned. */
export function portraitOrder(list: LayoutSession[], rank: Map<string, number>): string[] {
  for (const s of [...list].sort(byStart)) if (!rank.has(keyOf(s))) rank.set(keyOf(s), rank.size);
  return [...list].sort((a, b) => rank.get(keyOf(a))! - rank.get(keyOf(b))! || byStart(a, b)).map((s) => s.id);
}

export function pageAfter(prev: string[], next: string[], cur: string | null): string | null {
  if (!next.length) return null;
  if (cur && next.includes(cur)) return cur;
  const i = cur ? prev.indexOf(cur) : -1;
  if (i < 0) return next[0];
  for (let j = i + 1; j < prev.length; j++) if (next.includes(prev[j])) return prev[j];
  for (let j = i - 1; j >= 0; j--) if (next.includes(prev[j])) return prev[j];
  return next[0];
}

export function stepIn(order: string[], cur: string | null, d: number): string | null {
  if (order.length < 2) return null;
  const i = Math.max(0, order.indexOf(cur ?? ""));
  return order[(i + d + order.length) % order.length];
}
