/** Spec §3.4 paging (2026-10-08: one project per page = one tab) and §2 label. Pure.
 *  Positions never move: groups keep first-appearance order (earliest session start), sessions keep start order.
 *  Every session is a full card; the needs-you card is marked by its glow, not by moving. */
export interface PageGroup { key: string; name: string; sessions: { id: string }[] }
export interface Page { groups: PageGroup[] }
export type LayoutSession = { id: string; name: string; openUrl: string | null; status: string; startedAt: number; lastEventAt: number; worktree?: string | null; title?: string | null };
import { NEEDS } from "./config";
/** Needs you = the human must act (an escalation is the agent ladder). Single source: config NEEDS. */
export const NEEDS_YOU: ReadonlySet<string> = NEEDS;
/** Needs you on dots, header and foot: a NEEDS status, or Remote Control taken over (spec §7). */
export function needsYou(s: { rc?: { takenOverAt: number } | null }, st: string): boolean { return NEEDS_YOU.has(st) || !!s.rc; }

export const keyOf = (s: LayoutSession) => s.openUrl ?? s.name;
export const byStart = (a: LayoutSession, b: LayoutSession) => a.startedAt - b.startedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function layoutPages(list: LayoutSession[]): Page[] {
  const by = new Map<string, LayoutSession[]>();
  for (const s of list) by.set(keyOf(s), [...(by.get(keyOf(s)) ?? []), s]);
  const groups = [...by.entries()].map(([key, ss]) => {
    const sorted = [...ss].sort(byStart);
    return { key, name: sorted[0].name, ss: sorted, first: sorted[0] };
  }).sort((a, b) => byStart(a.first, b.first) || (a.key < b.key ? -1 : 1));
  return groups.map((g) => ({ groups: [{ key: g.key, name: g.name, sessions: g.ss.map((s) => ({ id: s.id })) }] }));
}

export function sessionLabel(s: LayoutSession, all: LayoutSession[]): { wt: string; title: string | null } {
  const wt = s.worktree ?? null;
  const peers = all.filter((o) => keyOf(o) === keyOf(s) && (o.worktree ?? null) === wt).sort((a, b) => a.startedAt - b.startedAt);
  const i = peers.findIndex((o) => o.id === s.id);
  const base = wt ?? "main";
  return { wt: peers.length > 1 && i > 0 ? `${base} ${i + 1}` : base, title: s.title?.trim() || null };
}
