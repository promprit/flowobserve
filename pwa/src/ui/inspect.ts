import type { NodeKey } from "@fo/shared";
import { vscodeFor } from "../edition";
import { manual, pager } from "../pager";
import { wake } from "../scene/demand";
import { orbit } from "../scene/orbit";
import { type CSession, changed, hooks, now, store, ui, view, type Pick as Hit } from "../state";
import { $, clamp, coarseFmt, nav, runFmt, safeOpenUrl } from "../util";
import { selectAgent } from "./agents";

// ---------- pure: what the popover says, and where it goes ----------

export interface Pop { lines: { cls: "head" | "task" | "wait" | "log"; text: string }[]; openUrl: string | null }
const MODEL = { haiku: "Haiku", sonnet: "Sonnet", opus: "Opus", fable: "Fable" } as const;
const firstAt = (a: (number | null)[] | undefined) => { let m: number | null = null; for (const v of a ?? []) if (v !== null && (m === null || v < m)) m = v; return m; };

/** Spec §3 content, top to bottom, only lines that have data. Null = this node has nothing to say. */
export function popoverContent(s: CSession | undefined, key: NodeKey, nowMs: number): Pop | null {
  const n = s?.nodes?.find((x) => x.key === key);
  if (!s || !n) return null;
  const lines: Pop["lines"] = [];
  const since = n.startedAt === null ? null : nowMs - n.startedAt;
  if (key === "you") {
    if (n.waiting) lines.push({ cls: "wait", text: n.waiting });
    lines.push({ cls: "head", text: since === null ? "waiting" : `waiting ${coarseFmt(since)}` });
  } else if (n.state === "current") {
    const c0 = firstAt(s.stageAt);
    const head = [since !== null ? `in stage ${coarseFmt(since)}` : "", c0 !== null ? `cycle ${coarseFmt(nowMs - c0)}` : ""].filter(Boolean).join(" · ");
    if (head) lines.push({ cls: "head", text: head });
  } else {
    lines.push({ cls: "head", text: [n.model ? MODEL[n.model] : "", n.state, since !== null ? runFmt(since) : ""].filter(Boolean).join(" · ") });
    if (n.task) lines.push({ cls: "task", text: n.task });
  }
  for (const l of s.log.slice(-3)) lines.push({ cls: "log", text: l.text });
  return { lines, openUrl: vscodeFor(s) ? safeOpenUrl(s.openUrl) : null };
}

export interface Anchor { x: number; y: number; r: number }
export type Side = "above" | "below" | "left" | "right";
/** Above the node; flips below, left, right to stay inside the zone. Slides along the free axis first, so it never covers the node. */
export function placePopover(a: Anchor, w: number, h: number, W: number, H: number, gap = 10, margin = 8): { x: number; y: number; side: Side } {
  const fits = (x: number, y: number) => x >= margin && y >= margin && x + w <= W - margin && y + h <= H - margin;
  const cand: [Side, number, number][] = [
    ["above", a.x - w / 2, a.y - a.r - gap - h],
    ["below", a.x - w / 2, a.y + a.r + gap],
    ["left", a.x - a.r - gap - w, a.y - h / 2],
    ["right", a.x + a.r + gap, a.y - h / 2],
  ];
  for (const [side, x, y] of cand) {
    const vert = side === "above" || side === "below";
    const cx = vert ? clamp(x, margin, W - margin - w) : x, cy = vert ? y : clamp(y, margin, H - margin - h);
    if (fits(cx, cy)) return { x: cx, y: cy, side };
  }
  return { x: clamp(cand[0][1], margin, Math.max(margin, W - margin - w)), y: margin, side: "above" };
}

// ---------- DOM: one popover at a time ----------

export const INSPECT = { intentMs: 120, leaveMs: 200, pinMs: 20_000 } as const;
type Open = { id: string; key: NodeKey };
const st = { open: null as Open | null, intent: 0 as ReturnType<typeof setTimeout> | 0, leave: 0 as ReturnType<typeof setTimeout> | 0 };
let el: HTMLElement | null = null, body: HTMLElement, sr: HTMLElement, openA: HTMLAnchorElement, winBound = false;
const stop = (k: "intent" | "leave") => { if (st[k]) clearTimeout(st[k]); st[k] = 0; };

export const inspectState = (): Open | null => st.open;

/** Cursor follows the view: zoom-in only in overview; grabbing while orbiting in focus. */
export function syncCursor(): void {
  const loop = $("#loop"); if (!loop) return;
  loop.dataset.view = view.zt >= 0.6 ? "focus" : "overview";
  if (orbit.dragging) loop.dataset.drag = "1"; else delete loop.dataset.drag;
}

const sig = (rows: { className: string; textContent: string | null }[]) => rows.map((r) => `${r.className}:${r.textContent}`).join("\n");
function render(pop: Pop, announce = false): void {
  const rows = pop.lines.map((l) => { const d = document.createElement("div"); d.className = l.cls; d.textContent = l.text; return d; });
  if (sig([...body.children] as HTMLElement[]) !== sig(rows)) body.replaceChildren(...rows);
  if (announce) sr.textContent = pop.lines.map((l) => l.text).join(". ");
  if (pop.openUrl) { openA.href = pop.openUrl; openA.hidden = false; } else { openA.removeAttribute("href"); openA.hidden = true; }
}

export function openInspect(id: string, key: NodeKey): boolean {
  if (!el) return false;
  stop("intent"); stop("leave");
  const pop = popoverContent(store.sessions.get(id), key, now());
  if (!pop) { closeInspect(); return false; }
  const fresh = !st.open || st.open.id !== id || st.open.key !== key;
  st.open = { id, key }; ui.inspecting = true;
  render(pop, fresh); el.hidden = false; placeInspect(); wake(performance.now()); changed();
  return true;
}

export function closeInspect(): boolean {
  stop("intent"); stop("leave");
  if (!st.open || !el) { st.open = null; ui.inspecting = false; return false; }
  st.open = null; ui.inspecting = false; el.hidden = true;
  pager.pinUntil = Math.max(pager.pinUntil, now() + INSPECT.pinMs);
  const a = document.activeElement, loop = $("#loop");
  if (loop && (a === document.body || !a || loop.contains(a) || el.contains(a))) loop.focus({ preventScroll: true });
  sr.textContent = "";
  changed();
  return true;
}

/** Per rendered frame: follow the node on screen. */
export function placeInspect(): void {
  if (!st.open || !el) return;
  const a = hooks.nodeScreen(st.open.key), loop = $("#loop");
  if (!a || !loop) { closeInspect(); return; }
  const p = placePopover(a, el.offsetWidth, el.offsetHeight, loop.clientWidth, loop.clientHeight);
  el.style.transform = `translate3d(${p.x.toFixed(1)}px,${p.y.toFixed(1)}px,0)`;
  el.dataset.side = p.side;
}

/** Per UI tick: refresh times; close when the session left, the pager moved on, or the node has nothing left to say. */
export function tickInspect(): void {
  syncCursor();
  const o = st.open; if (!o) return;
  const pop = o.id === pager.focus ? popoverContent(store.sessions.get(o.id), o.key, now()) : null;
  if (!pop) { closeInspect(); return; }
  render(pop);
}

function focusAction(): void {
  const o = st.open; if (!o) return;
  closeInspect(); manual(o.id); hooks.headSwap();
}

export function bindInspect(): void {
  el = $("#inspect"); const loop = $("#loop");
  if (!el || !loop) return;
  body = el.querySelector(".body")!; sr = el.querySelector(".sr")!; openA = el.querySelector("a.open")!;
  const pop = el;
  const at = (x: number, y: number): Hit | null => (view.zt >= 0.6 ? hooks.pick(x, y) : null);
  const nodeHit = (hit: Hit | null) => (hit && hit.nodeKey && hit.sessionId === pager.focus ? { id: hit.sessionId, key: hit.nodeKey } : null);
  const agentHit = (hit: Hit | null) => (hit && hit.agentId && hit.sessionId === pager.focus ? { id: hit.sessionId, aid: hit.agentId } : null);
  hooks.inspectAt = (x, y) => {
    const hit = at(x, y), a = agentHit(hit);
    if (a) { closeInspect(); selectAgent(a.id, a.aid); return true; } // agent detail lives in the card (spec), and a tap on an orb never zooms out
    const n = nodeHit(hit); if (n && openInspect(n.id, n.key)) return true; const was = !!st.open; closeInspect(); return was;
  };
  hooks.inspectClose = closeInspect;

  loop.addEventListener("pointermove", (e) => { // desktop hover, 120 ms intent
    const pe = e as PointerEvent;
    if ((pe.pointerType && pe.pointerType !== "mouse") || pe.buttons) return;
    const r = loop.getBoundingClientRect(), hit = at(pe.clientX - r.left, pe.clientY - r.top), a = agentHit(hit), n = a ? null : nodeHit(hit);
    if (a) { // hovering an orb selects it after the intent (no toggle); an open popover closes as for empty space
      stop("intent");
      if (st.open && !st.leave && !pop.matches(":hover")) st.leave = setTimeout(closeInspect, INSPECT.leaveMs);
      const cur = ui.agentSel;
      if (!cur || cur.sid !== a.id || cur.aid !== a.aid) st.intent = setTimeout(() => selectAgent(a.id, a.aid, false), INSPECT.intentMs);
      return;
    }
    if (n) {
      stop("leave");
      if (st.open && st.open.key === n.key && st.open.id === n.id) return;
      stop("intent"); st.intent = setTimeout(() => openInspect(n.id, n.key), INSPECT.intentMs);
    } else {
      stop("intent");
      if (st.open && !st.leave && !pop.matches(":hover")) st.leave = setTimeout(closeInspect, INSPECT.leaveMs);
    }
  });
  loop.addEventListener("pointerleave", (e) => {
    const pe = e as PointerEvent;
    if (pe.pointerType && pe.pointerType !== "mouse") return;
    stop("intent");
    if (st.open && !st.leave && !pop.matches(":hover")) st.leave = setTimeout(closeInspect, INSPECT.leaveMs);
  });
  loop.addEventListener("pointermove", syncCursor, { passive: true });
  pop.addEventListener("pointerenter", () => stop("leave"));
  pop.addEventListener("pointerleave", () => { stop("leave"); st.leave = setTimeout(closeInspect, INSPECT.leaveMs); });
  pop.addEventListener("pointerdown", (e) => e.stopPropagation()); // clicks inside never reach the loop's gestures
  pop.querySelector("button.focus")!.addEventListener("click", focusAction);
  openA.addEventListener("click", (e) => { e.preventDefault(); const u = openA.getAttribute("href"); if (u) nav.go(u); });

  loop.addEventListener("keydown", (e) => { // Tab cycles the focused loop's nodes; past the end, focus moves on
    if (e.key !== "Tab" || e.metaKey || e.ctrlKey || e.altKey || view.zt < 0.6) return;
    const s = store.sessions.get(pager.focus ?? ""), keys = (s?.nodes ?? []).map((n) => n.key);
    if (!s || !keys.length) return;
    const i = st.open ? keys.indexOf(st.open.key) : -1, j = i + (e.shiftKey ? -1 : 1);
    if (j < 0 || j >= keys.length) { closeInspect(); return; }
    e.preventDefault(); e.stopPropagation();
    openInspect(s.id, keys[j]);
  });

  if (winBound) return;
  winBound = true;
  addEventListener("pointerdown", (e) => { // a tap anywhere outside the popover and the loop dismisses it
    if (!st.open) return;
    const t = e.target as Node | null;
    if (t && (el?.contains(t) || $("#loop")?.contains(t))) return;
    closeInspect();
  }, true);
  addEventListener("keydown", (e) => {
    if (!st.open || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key !== "f" && e.key !== "F") return;
    const t = e.target;
    if (t instanceof Element && t.closest("input,textarea,select,[contenteditable]:not([contenteditable=false])")) return;
    e.preventDefault(); focusAction();
  });
}
