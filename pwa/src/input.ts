import { RESUME, SWIPE } from "./config";
import { go, manual, overview, pager, seenInput, step } from "./pager";
import { go as helperGo } from "./helper";
import { goHome, isDrag, orbit, orbitBy } from "./scene/orbit";
import { changed, hooks, now, store, ui, view } from "./state";
import { closeDrawer, drawerOpen } from "./ui/drawer";
import { diffUrl, jump } from "./ui/verbs";
import { $, clamp } from "./util";

let bound = false;
let simRef: { key(k: string): boolean } | undefined;

function zoomBy(delta: number, x: number, y: number): void {
  const was = view.zt;
  view.zt = clamp(view.zt + delta, 0, 1);
  pager.pinUntil = now() + RESUME;
  if (delta > 0) {
    const id = hooks.pick(x, y)?.sessionId;
    if (id && id !== pager.focus) go(id);
  }
  if ((was >= 0.5) !== (view.zt >= 0.5)) hooks.headSwap();
  seenInput(); changed();
}

type P = { x0: number; y0: number; x: number; y: number };
type Two = { cx0: number; d0: number; mode: "" | "swipe" | "pinch"; paged: boolean };

function bindLoop(loopEl: HTMLElement): void {
  // Trackpad: one gesture = wheel events with gaps < quietMs (the momentum tail included). The gesture keeps the axis of
  // its first event: x pages once, y zooms. Pinch arrives as ctrl+wheel (Chrome/Firefox) or gesture events (Safari).
  let wg: { axis: "x" | "y"; sum: number; paged: boolean; last: number } | null = null;
  loopEl.addEventListener("wheel", (e) => {
    e.preventDefault();
    const t = now(), r = loopEl.getBoundingClientRect(), u = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1;
    if (e.ctrlKey) { zoomBy(-e.deltaY * u * 0.01, e.clientX - r.left, e.clientY - r.top); return; }
    if (!wg || t - wg.last > SWIPE.quietMs) wg = { axis: Math.abs(e.deltaX) > Math.abs(e.deltaY) ? "x" : "y", sum: 0, paged: false, last: t };
    wg.last = t;
    if (wg.axis === "x") {
      if (wg.paged) return;
      wg.sum += e.deltaX * u;
      if (Math.abs(wg.sum) >= SWIPE.wheel) { step(wg.sum > 0 ? 1 : -1); wg.paged = true; }
      return;
    }
    zoomBy(-e.deltaY * u * 0.0016, e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });
  let gScale = 1; // Safari trackpad pinch (non-standard GestureEvent: scale relative to gesture start)
  const gesture = (e: Event) => {
    e.preventDefault();
    const s = (e as Event & { scale?: number }).scale ?? 1, r = loopEl.getBoundingClientRect();
    if (e.type === "gesturestart") { gScale = s; return; }
    zoomBy((s - gScale) * 0.8, r.width / 2, r.height / 2); gScale = s;
  };
  for (const type of ["gesturestart", "gesturechange", "gestureend"]) loopEl.addEventListener(type, gesture);

  const ptrs = new Map<number, P>();
  let moved = false, two: Two | null = null;
  const pair = () => { const [a, b] = [...ptrs.values()]; return { cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) }; };
  const end = (id: number) => { ptrs.delete(id); if (!ptrs.size) { orbit.dragging = false; two = null; } };

  loopEl.addEventListener("pointerdown", (e) => {
    try { loopEl.setPointerCapture?.(e.pointerId); } catch { /* unsupported or already gone */ }
    ptrs.set(e.pointerId, { x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY });
    if (ptrs.size === 1) moved = false;
    if (ptrs.size === 2) { const q = pair(); two = { cx0: q.cx, d0: q.d, mode: "", paged: false }; orbit.dragging = false; moved = true; }
  });
  loopEl.addEventListener("pointermove", (e) => {
    const p = ptrs.get(e.pointerId); if (!p) return;
    if (e.pointerType === "mouse" && !e.buttons) { end(e.pointerId); return; } // released outside the window
    const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
    if (two && ptrs.size === 2) { // lock the gesture once it has travelled, so finger jitter neither zooms nor pages
      const q = pair(), dc = q.cx - two.cx0, dd = q.d - two.d0;
      if (!two.mode) two.mode = Math.abs(dc) >= SWIPE.lock && Math.abs(dc) > Math.abs(dd) ? "swipe" : Math.abs(dd) >= SWIPE.lock ? "pinch" : "";
      if (two.mode === "swipe" && !two.paged && Math.abs(dc) >= SWIPE.px) { step(dc < 0 ? 1 : -1); two.paged = true; }
      if (two.mode === "pinch") { const r = loopEl.getBoundingClientRect(); zoomBy(dd / 400, q.cx - r.left, q.cy - r.top); two.d0 = q.d; }
      return;
    }
    if (!moved && isDrag(p.x0, p.y0, p.x, p.y)) { moved = true; orbit.dragging = true; hooks.inspectClose(); }
    if (moved && orbit.dragging) { orbitBy(dx, dy, ui.portrait, now()); changed(); }
  });
  loopEl.addEventListener("pointerup", (e) => {
    if (!ptrs.has(e.pointerId)) return;
    const wasMoved = moved;
    end(e.pointerId);
    if (wasMoved) return;
    const r = loopEl.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    if (view.zt < 0.6) { const hit = hooks.pick(x, y); if (hit) { manual(hit.sessionId); hooks.headSwap(); } }
    else if (!hooks.inspectAt(x, y)) overview(); // empty space, nothing to close: back to every loop
  });
  loopEl.addEventListener("pointercancel", (e) => end(e.pointerId));
  loopEl.addEventListener("lostpointercapture", (e) => end(e.pointerId));
  addEventListener("blur", () => { ptrs.clear(); two = null; orbit.dragging = false; });
}

function openDiffKey(): boolean {
  const s = store.sessions.get(pager.focus ?? ""), u = s ? diffUrl(s) : null;
  if (u) helperGo(u);
  return !!u;
}

export function bindInput(sim?: { key(k: string): boolean }): void {
  simRef = sim;
  const loopEl = $("#loop");
  if (loopEl && !loopEl.dataset.bound) { loopEl.dataset.bound = "1"; bindLoop(loopEl); }
  if (bound) return;
  bound = true;

  let pm: [number, number] | null = null;
  addEventListener("pointermove", (e) => {
    if (pm && Math.hypot(e.clientX - pm[0], e.clientY - pm[1]) > 40) { seenInput(); pm = [e.clientX, e.clientY]; }
    else if (!pm) pm = [e.clientX, e.clientY];
  }, { passive: true });
  addEventListener("pointerdown", seenInput);

  addEventListener("keydown", (e) => {
    seenInput();
    if (e.defaultPrevented) return;
    const tg = e.target;
    if (tg instanceof Element && (/^(INPUT|TEXTAREA|SELECT)$/.test(tg.tagName) || (tg as HTMLElement).isContentEditable || tg.closest("#sheet"))) return;
    const k = e.key;
    if (k === "Escape" && drawerOpen()) { closeDrawer(); return; }
    if (k === "Escape" && hooks.inspectClose()) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (k === "ArrowRight" || k === "ArrowDown") step(1);
    else if (k === "ArrowLeft" || k === "ArrowUp") step(-1);
    else if (k === "-" || k === "_" || k === "Escape") overview();
    else if (k === "+" || k === "=") { view.zt = 1; pager.pinUntil = now() + RESUME; hooks.headSwap(); }
    else if (k === "0" || k === "Home") { goHome(now(), ui.reduce); changed(); }
    else if (k === "Enter") {
      const t = e.target as Element | null;
      if (t instanceof Element && (t.id === "usage" || t.closest("#tabs") || t.closest("#drawer") || t.closest("#inspect"))) return;
      const s = store.sessions.get(pager.focus ?? "");
      if (s) jump(s);
    }
    else if (k === "j" || k === "J") { const s = store.sessions.get(pager.focus ?? ""); if (s) jump(s); }
    else if ((k === "d" || k === "D") && openDiffKey()) { /* handled */ }
    else if (store.demo && simRef && !ui.inspecting) simRef.key(k);
  });
}
