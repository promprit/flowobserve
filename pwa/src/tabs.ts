/** Spec 2026-10-08 §2 tab strip. Pure. Portrait: one tab per session; landscape: one tab per project. */
import { byStart, keyOf, type LayoutSession, type Page } from "./layout";

export interface Tab { id: string; key: string; name: string; num: number | null; need: boolean }

/** Running number = position by start among the project's live sessions; shown only when the project has 2+. */
export function portraitTabs(list: LayoutSession[], order: string[], need: (id: string) => boolean): Tab[] {
  const by = new Map(list.map((s) => [s.id, s])), peers = new Map<string, LayoutSession[]>();
  for (const s of [...list].sort(byStart)) peers.set(keyOf(s), [...(peers.get(keyOf(s)) ?? []), s]);
  return order.filter((id) => by.has(id)).map((id) => {
    const s = by.get(id)!, p = peers.get(keyOf(s))!;
    return { id, key: keyOf(s), name: s.name, num: p.length > 1 ? p.indexOf(s) + 1 : null, need: need(id) };
  });
}

export function landscapeTabs(pages: Page[], need: (id: string) => boolean): Tab[] {
  return pages.flatMap((p) => p.groups).map((g) => ({ id: g.key, key: g.key, name: g.name, num: null, need: g.sessions.some((x) => need(x.id)) }));
}
