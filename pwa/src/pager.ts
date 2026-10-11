import type { Status } from "@fo/shared";
import { ATTN, HOVER, RESUME } from "./config";
import type { LayoutSession } from "./layout";
import { pageAfter, portraitOrder, stepIn } from "./portrait";
import { eff, sorted } from "./select";
import { type CSession, changed, hooks, now, store, ui, view } from "./state";

export const pager = {
  focus: null as string | null, pinned: null as string | null, pinUntil: 0, hover: null as string | null,
};
export const celebrate = { id: null as string | null, at: 0 };
export const pp = { order: [] as string[], rank: new Map<string, number>() };
const lay = (): LayoutSession[] => [...store.sessions.values()].map((s) =>
  ({ id: s.id, name: s.name, openUrl: s.openUrl, status: eff(s), startedAt: s.startedAt, lastEventAt: s.lastEventAt, worktree: s.worktree, title: s.title }));

/** Portrait: the page is pager.focus; it stays on the same id, or moves to the neighbour when that session ended (spec §4). */
export function portraitSync(): string[] {
  const next = portraitOrder(lay(), pp.rank), f = pageAfter(pp.order, next, pager.focus);
  pp.order = next;
  if (f !== pager.focus) { pager.focus = f; hooks.headSwap(); changed(); }
  return next;
}
const timers: { in?: ReturnType<typeof setTimeout>; out?: ReturnType<typeof setTimeout> } = {};

/** Attention only marks the session unseen (its loop and card glow); the camera moves only when the user asks. */
export function onStatus(s: CSession, prev: Status): void {
  if (store.ff) return;
  if (!ATTN[s.status] || s.status === prev) return;
  s.seen = false;
  if (s.status === "shipped") { celebrate.id = s.id; celebrate.at = now(); s.washAt = now(); }
}

export function go(id: string): void {
  if (!store.sessions.has(id) || id === pager.focus) { pager.focus = id; return; }
  pager.focus = id;
  hooks.headSwap(); changed();
}

function zoom(zt: number): void {
  if (view.zt === zt) return;
  view.zt = zt; hooks.headSwap(); changed();
}

/** Look at one loop: zoom in on it and count its attention as seen. */
function look(id: string): void {
  const s = store.sessions.get(id);
  if (s && !s.seen) { s.seen = true; changed(); }
  view.zt = 1; go(id); hooks.headSwap();
}

/** A click (card, loop, keys): stay on that loop for RESUME, then back to the overview. */
export function manual(id: string, zoomIn = true): void {
  pager.pinUntil = now() + RESUME; pager.pinned = id;
  if (zoomIn) look(id); else go(id);
}

/** Back to the overview now (Esc, -, empty click). */
export function overview(): void {
  pager.pinned = null;
  zoom(0);
}

/** Pointer over a card: preview its loop after HOVER.inMs (a quick sweep moves nothing). */
export function hoverEnter(id: string): void {
  clearTimeout(timers.out); clearTimeout(timers.in);
  timers.in = setTimeout(() => { if (store.sessions.has(id)) { pager.hover = id; look(id); } }, HOVER.inMs);
}

/** Pointer off the cards: after HOVER.outMs go back to the clicked loop if still pinned, else to the overview. */
export function hoverLeave(): void {
  clearTimeout(timers.in);
  if (!pager.hover) return;
  clearTimeout(timers.out);
  timers.out = setTimeout(() => {
    pager.hover = null;
    if (pager.pinned && now() < pager.pinUntil && store.sessions.has(pager.pinned)) look(pager.pinned);
    else zoom(0);
  }, HOVER.outMs);
}

export function step(d: number): void {
  if (ui.portrait) { const id = stepIn(portraitSync(), pager.focus, d); if (id) manual(id); return; }
  const list = sorted(); if (list.length < 2) return;
  const i = list.findIndex((s) => s.id === pager.focus);
  manual(list[(i + d + list.length) % list.length].id);
}

export function pagerTick(): void {
  const list = sorted();
  if (!list.length) { pager.focus = null; return; }
  if (ui.portrait) portraitSync();
  else if (!pager.focus || !store.sessions.has(pager.focus)) { pager.focus = list[0].id; hooks.headSwap(); }
  if (pager.hover && !store.sessions.has(pager.hover)) pager.hover = null; // its card left the DOM without a pointerleave
  if (view.zt > 0 && !pager.hover && !ui.inspecting && now() > pager.pinUntil) { pager.pinned = null; zoom(0); }
}

let wakeLock: WakeLockSentinel | null = null;
export function seenInput(): void {
  if (!wakeLock && typeof navigator !== "undefined" && "wakeLock" in navigator)
    navigator.wakeLock.request("screen").then((l) => { wakeLock = l; l.addEventListener("release", () => { wakeLock = null; }); }).catch(() => {});
}

export function resetPager(): void {
  clearTimeout(timers.in); clearTimeout(timers.out);
  Object.assign(pager, { focus: null, pinned: null, pinUntil: 0, hover: null });
  Object.assign(celebrate, { id: null, at: 0 });
  pp.order = []; pp.rank.clear();
}
