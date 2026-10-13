import { STAGES, cardLabel } from "@fo/shared/status";
import { ATTN, NEEDS, SWIPE } from "../config";
import { NEEDS_YOU, keyOf, type LayoutSession, type Page, layoutPages, sessionLabel } from "../layout";
import { go as pagerGo, hoverEnter, hoverLeave, manual, pager, pp, step } from "../pager";
import { stallMin } from "../scene/rate";
import { eff, sorted } from "../select";
import { type CSession, changed, hooks, now, store, ui, view } from "../state";
import { pushLog } from "../store";
import { $, clamp, clock, dur, esc, nav, safeSessionUrl } from "../util";
import { go, helperReady, helperUrl, itermOf } from "../helper";
import { glyphOf } from "./glyph";
import { renderTabs } from "./tabs";
import { vscodeFor } from "../edition";
import { CLEAR_CONFIRM, type Step, copyText, ctxLabel, nextStep, sessionLink, showRow } from "./session";
import { diffUrl, jump, readerKind, resultsLine, verbFor } from "./verbs";
import { MAXL, agentView, type AgentView } from "../agents";
import { bindAgents, clearStaleSel, renderAgents, selected } from "./agents";

const cardEls = new Map<string, HTMLElement>();

/** The terminal is bottom-anchored (spec §4): hide only lines wholly above the box; a partly visible line stays under the top fade. */
function fitTerm(t: HTMLElement): void {
  const ls = Array.from(t.children) as HTMLElement[];
  for (const l of ls) l.style.display = "";
  const top = t.getBoundingClientRect().top;
  for (let i = ls.length - 2; i >= 0; i--) {
    const r = ls[i].getBoundingClientRect();
    if (r.height > 0 && r.bottom <= top) { for (let j = i; j >= 0; j--) ls[j].style.display = "none"; break; }
  }
  for (let i = 0; i < ls.length; i++) ls[i].style.opacity = ls.length - i > 4 ? "0.6" : "";
  const first = ls.find((l) => l.style.display !== "none");
  if (first) first.classList.remove("same");
  const visible = ls.filter((l) => l.style.display !== "none").length;
  t.classList.toggle("multi", visible > 1);
}

export const cpage: { i: number; pages: number; list: Page[]; fleet: Page[] } = { i: 0, pages: 1, list: [], fleet: [] };
let lastPage = -1, lastFocus: string | null = null;
const groupEls = new Map<string, HTMLElement>();

export function resetCards(): void { Object.assign(cpage, { i: 0, pages: 1, list: [], fleet: [] }); lastPage = -1; lastFocus = null; }

/** Flip the card dock; the loop zone shows every page already, so neither focus nor camera moves.
 *  A hovered card leaves the DOM without a pointerleave, so the flip ends any hover preview itself. */
export function setCardPage(i: number): void {
  cpage.i = i;
  hoverLeave();
  changed();
}

/** Landscape tab: show project page i and focus its first session by start (no zoom; the loop zone keeps its overview). */
export function selectProject(i: number): void {
  const n = cpage.fleet.length; if (!n) return;
  const p = clamp(i, 0, n - 1), first = cpage.fleet[p].groups[0]?.sessions[0]?.id;
  if (p === cpage.i && cpage.fleet[p].groups.some((g) => g.sessions.some((x) => x.id === pager.focus))) return;
  setCardPage(p);
  if (first) pagerGo(first);
}

/** Hide the card now, then ask the server to retire the session (it returns only if the session acts again). */
function dismiss(id: string): void {
  const token = store.helperToken;
  store.sessions.delete(id);
  changed();
  if (!token) return;
  void fetch("/api/dismiss", { method: "POST", headers: { "x-fo-token": token, "content-type": "application/json" }, body: JSON.stringify({ sid: id }) }).catch(() => {});
}

function makeCard(s: CSession): HTMLElement {
  const el = document.createElement("div");
  el.className = "card";
  el.innerHTML = '<div class="c1"><i class="dot"></i><div class="lbl"><span class="wt"></span><span class="sep">·</span><span class="ti"></span><span class="bgc">BACKGROUND</span><span class="acct"></span></div><div class="btns"><a role="button" tabindex="0" data-step="handoff">HANDOFF</a><a role="button" tabindex="0" data-step="clear">CLEAR</a><a role="button" tabindex="0" data-step="resume">RESUME</a></div><span class="tm"></span></div><div class="c2"><span class="lb"></span><span class="bar">' + "<b></b>".repeat(7) + '</span><span class="ctx"></span><span class="note"></span></div><div class="ag"><span class="pips"></span><span class="as"></span><div class="lanes"></div><span class="atl"></span></div><div class="term"></div><div class="agd"></div><p class="q"></p><div class="res"></div><div class="chips"><div class="act"></div><span class="rc">RC TAKEN OVER</span><a class="diff" role="button" tabindex="0">DIFF</a></div><button type="button" class="dismiss" aria-label="Dismiss session">×</button>';
  bindAgents(el, s.id);
  el.querySelector(".dismiss")!.addEventListener("click", (e) => { e.stopPropagation(); dismiss(s.id); });
  el.addEventListener("click", (e) => {
    if (e.metaKey) { e.stopPropagation(); jump(store.sessions.get(s.id) ?? s); return; }
    manual(s.id);
  });
  el.addEventListener("pointerenter", (e) => { if (e.pointerType === "mouse") hoverEnter(s.id); });
  el.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") hoverLeave(); });
  el.querySelector(".act")!.addEventListener("click", (e) => {
    if (!el.classList.contains("has-act") || store.link !== "live") return;
    e.stopPropagation();
    const cur = store.sessions.get(s.id);
    if (!cur) return;
    if (!cur.action) { verbFor(cur)?.run(); return; }
    const k = readerKind(cur);
    if (k) {
      hooks.openReader?.(cur.id, k, () => {
        const c = store.sessions.get(s.id);
        if (c) jump(c);
      });
      return;
    }
    jump(cur);
  });
  const openDiff = (e: Event) => {
    e.stopPropagation();
    const cur = store.sessions.get(s.id), u = cur ? diffUrl(cur) : null;
    if (u) go(u);
  };
  const diffEl = el.querySelector<HTMLElement>(".diff")!;
  diffEl.addEventListener("click", openDiff);
  diffEl.addEventListener("keydown", (e) => { if ((e as KeyboardEvent).key === "Enter") openDiff(e); });
  const btns = el.querySelector<HTMLElement>(".btns")!, note = el.querySelector<HTMLElement>(".note")!;
  let noteT: ReturnType<typeof setTimeout> | undefined;
  const press = (e: Event) => {
    const a = (e.target as HTMLElement).closest<HTMLElement>("[data-step]");
    if (!a) return;
    e.stopPropagation();
    if (a.classList.contains("off") || store.link !== "live") return;
    const step = a.dataset.step as Step, cur = store.sessions.get(s.id), iterm = !!cur && helperReady(cur);
    if (!cur || !(iterm || vscodeFor(cur))) return;
    const u = iterm ? helperUrl.step(itermOf(cur.jumpUrl) ?? "", step) : safeSessionUrl(sessionLink(s.id, step));
    if (!u) return;
    if (step === "clear" && CLEAR_CONFIRM && !confirm("Clear this session?")) return;
    const text = copyText(step);
    // Inside the click (user gesture), before navigating. The note only claims a copy once writeText resolved.
    const say = (t: string) => {
      note.textContent = t;
      clearTimeout(noteT);
      noteT = setTimeout(() => { note.textContent = ""; }, 4000);
    };
    if (iterm) { if (go(u)) say(`Sent ${text}`); return; }
    const typed = () => say(`Type ${text} + Enter`);
    try {
      const p = navigator.clipboard?.writeText(text);
      if (p) p.then(() => say(`Copied ${text} — paste + Enter`), typed); else typed();
    } catch { typed(); }
    nav.go(u);
  };
  btns.addEventListener("click", press);
  btns.addEventListener("keydown", (e) => {
    const k = (e as KeyboardEvent).key;
    if (k === " ") e.preventDefault();
    if (k === "Enter" || k === " ") press(e);
  });
  cardEls.set(s.id, el);
  return el;
}

function setLabel(el: HTMLElement, s: CSession, all: LayoutSession[]): void {
  const l = sessionLabel(s as LayoutSession, all);
  el.querySelector(".wt")!.textContent = l.wt.toUpperCase();
  const ti = el.querySelector<HTMLElement>(".ti")!, sep = el.querySelector<HTMLElement>(".sep")!;
  ti.textContent = l.title ?? ""; sep.style.display = ti.style.display = l.title ? "" : "none";
}

/** Account label, only with several accounts; a plain Claude Code account gets a NO DRYAS tag. */
function setAccount(el: HTMLElement, s: CSession): void {
  const ac = el.querySelector<HTMLElement>(".acct")!, a = s.account;
  const key = a ? `${a.label}|${a.dryas}` : "";
  if (ac.dataset.k === key) return;
  ac.dataset.k = key;
  ac.innerHTML = a ? esc(a.label.toUpperCase()) + (a.dryas ? "" : '<span class="nd">NO DRYAS</span>') : "";
}

function setCtx(el: HTMLElement, s: CSession): void {
  const cl = ctxLabel(s), ce = el.querySelector<HTMLElement>(".ctx")!;
  ce.innerHTML = cl && s.ctx ? `<span class="ln"><s style="width:${Math.max(0, Math.min(100, 100 - s.ctx.pct * 100))}%"></s></span><span class="v">${esc(cl.text)}</span>` : "";
  ce.className = "ctx" + (cl && cl.level !== "ok" ? " " + cl.level : "");
}

function sync(parent: HTMLElement, want: HTMLElement[]): void {
  want.forEach((el, i) => { if (parent.children[i] !== el) parent.insertBefore(el, parent.children[i] || null); });
  while (parent.children.length > want.length) parent.lastElementChild!.remove();
}

/** Memo of the last overflow fit, per (page, dock height, content). */
const fit = { sig: "", tight: [] as string[], scroll: false };

export function renderCards(): void {
  const list = sorted(), box = $("#cards")!, off = store.link !== "live", t0 = now();
  clearStaleSel(t0);
  const views = new Map(list.map((s) => [s.id, agentView(s, t0)] as const));
  const agKey = (id: string) => { const v = views.get(id); return v ? `${Math.min(v.order.length, MAXL + 1)}${v.tally.spawned ? "t" : ""}${ui.agentSel?.sid === id ? "s" : ""}` : ""; };
  document.body.classList.toggle("empty", !list.length);
  const lay: LayoutSession[] = list.map((s) => ({ id: s.id, name: s.name, openUrl: s.openUrl, status: eff(s), startedAt: s.startedAt, lastEventAt: s.lastEventAt, worktree: s.worktree, title: s.title }));
  cpage.list = layoutPages(lay);
  cpage.fleet = cpage.list;
  if (ui.portrait) {
    const cur = pager.focus ? lay.find((x) => x.id === pager.focus) : undefined;
    cpage.list = cur ? [{ groups: [{ key: keyOf(cur), name: cur.name, sessions: [{ id: cur.id }] }] }] : [];
    slide(box, cur?.id ?? null);
  }
  const pages = Math.max(1, cpage.list.length);
  if (!ui.portrait && pager.focus !== lastFocus) { // follow a focus change (arrow keys) once; otherwise the page stays where the user put it
    lastFocus = pager.focus;
    const fi = cpage.list.findIndex((p) => p.groups.some((g) => g.sessions.some((x) => x.id === pager.focus))); if (fi >= 0) cpage.i = fi;
  }
  cpage.i = clamp(cpage.i, 0, pages - 1); cpage.pages = pages;
  const base = cpage.list[cpage.i] ?? { groups: [] };
  if (lastPage !== cpage.i) {
    if (lastPage >= 0 && !ui.reduce) { box.classList.remove("flip"); void box.offsetWidth; box.classList.add("flip"); }
    lastPage = cpage.i;
  }
  list.forEach((s) => pushLog(s));
  const live = new Set(list.map((s) => s.id));
  const sig = `${cpage.i}|${box.clientHeight}|` + base.groups.map((g) => g.sessions.map((x) => { const s = store.sessions.get(x.id); return `${x.id}:${s ? eff(s) : ""}:${s?.msg?.length ?? 0}:${s?.action ? 1 : 0}:${agKey(x.id)}`; }).join(",")).join(";");
  const paint = (tight: string[]) => paintPage(base, lay, off, box, new Set(tight), views);
  // Cards flex to an even share. A card whose content no longer fits goes .tight on its own (terminal hidden,
  // question clamped); the other cards keep their terminal.
  const cards = () => [...box.querySelectorAll<HTMLElement>(".card")];
  const overflows = (el: HTMLElement) => el.scrollHeight > el.clientHeight + 1;
  const boxOver = () => box.scrollHeight > box.clientHeight + 1;
  if (fit.sig === sig) { box.classList.toggle("scroll", fit.scroll); paint(fit.tight); }
  else {
    box.classList.remove("scroll");
    paint([]);
    const tight = (boxOver() ? cards() : cards().filter(overflows)).map((c) => c.dataset.id ?? "");
    if (tight.length) paint(tight);
    // Even tight, too many cards for the dock height: scroll rather than clip.
    const scroll = tight.length > 0 && (boxOver() || cards().some(overflows));
    box.classList.toggle("scroll", scroll);
    Object.assign(fit, { sig, tight, scroll });
  }
  for (const id of [...cardEls.keys()]) if (!live.has(id)) cardEls.delete(id);
  const keys = new Set(cpage.list.flatMap((p) => p.groups.map((g) => g.key)));
  for (const k of [...groupEls.keys()]) if (!keys.has(k)) groupEls.delete(k);
  renderTabs(lay);
}

let slidFrom: string | null = null;
function slide(box: HTMLElement, id: string | null): void {
  if (id === slidFrom) return;
  const o = pp.order, d = slidFrom && id ? o.indexOf(id) - o.indexOf(slidFrom) : 0;
  slidFrom = id;
  box.classList.remove("slide-l", "slide-r");
  if (!d || ui.reduce) return;
  void box.offsetWidth;
  box.classList.add(d > 0 ? "slide-l" : "slide-r");
}

function paintPage(page: Page, lay: LayoutSession[], off: boolean, box: HTMLElement, tight: ReadonlySet<string>, views: ReadonlyMap<string, AgentView | null>): void {
  const groupNodes: HTMLElement[] = [];
  const nVis = page.groups.reduce((n, g) => n + g.sessions.length, 0);
  for (const g of page.groups) {
    let ge = groupEls.get(g.key);
    if (!ge) {
      ge = document.createElement("section");
      ge.className = "group";
      groupEls.set(g.key, ge);
    }
    ge.dataset.key = g.key; ge.dataset.name = g.name;
    const kids: HTMLElement[] = [];
    for (const x of g.sessions) {
      const s = store.sessions.get(x.id);
      if (!s) continue;
      const st = eff(s);
      const cls = ["card", "st-" + st];
      if (tight.has(s.id)) cls.push("tight");
      if (off) cls.push("stale");
      else {
        if (ATTN[st]) cls.push("attn");
        if (NEEDS_YOU.has(st)) cls.push("need");
        if (s.rc) cls.push("has-rc");
        if (diffUrl(s)) cls.push("has-diff");
        if (ATTN[st] && st !== "shipped" && !s.seen) cls.push("breathe");
        if (s.washAt && now() - s.washAt < 900) cls.push("wash");
      }
      const el = cardEls.get(s.id) ?? makeCard(s);
      const focusedCard = s.id === pager.focus && !off && view.zt > 0.5;
      if (focusedCard) cls.push("focused");
      if (s.kind === "bg") cls.push("bg");
      if (!off && showRow(s, focusedCard)) cls.push("show-btns");
      const verb = s.action ? null : verbFor(s);
      const chip = s.action && (helperReady(s) || vscodeFor(s) || readerKind(s)) ? s.action : "";
      if ((chip && NEEDS.has(st)) || verb) cls.push("has-act");
      const av = views.get(s.id) ?? null, asel = selected(av, s.id);
      if (av && (av.order.length || (s.stage >= 5 && av.tally.spawned))) cls.push("has-ag");
      if (asel) cls.push("sel-ag");
      const c = cls.join(" "); if (el.className !== c) el.className = c;
      el.dataset.id = s.id;
      setLabel(el, s, lay);
      setAccount(el, s);
      el.querySelector(".tm")!.textContent = dur(now() - (s.since || now()));
      const q = off ? 0 : stallMin(s, now());
      el.querySelector(".lb")!.textContent = off ? `${STAGES[s.stage] ?? STAGES[0]} · STALE` : cardLabel(s, st) + (q ? ` · STALLED ${q}M` : "");
      setCtx(el, s);
      const next = nextStep(s);
      const stepsOk = helperReady(s) || vscodeFor(s);
      el.querySelector<HTMLElement>(".btns")!.hidden = !stepsOk;
      el.querySelectorAll<HTMLElement>("[data-step]").forEach((a) => {
        const step = a.dataset.step as Step, link = sessionLink(s.id, step);
        const off2 = !link || (step === "clear" && !s.handoff);
        a.className = (step === next ? "next" : "") + (off2 ? " off" : "");
        a.dataset.href = link ?? "";
        a.title = `Open this session in VS Code and copy ${copyText(step)} (paste + Enter)`;
      });
      el.querySelectorAll<HTMLElement>(".bar b").forEach((b, i) => {
        const kk = i < s.stage || (st === "shipped" && i < 6) ? "p" : i === s.stage ? "c" : "";
        if (b.className !== kk) b.className = kk;
      });
      const log = (s.log || []).slice(s.seeded ? -6 : nVis <= 1 ? -40 : -4);
      const key = log.length + "|" + (log.length ? log[log.length - 1].t : 0);
      const term = el.querySelector<HTMLElement>(".term")!;
      if (term.dataset.key !== key) {
        term.dataset.key = key;
        term.innerHTML = log.slice().sort((a, b) => a.t - b.t).map((l, i, A) => { const g = glyphOf(l.text); return `<div class="ln${i && clock(A[i - 1].t) === clock(l.t) ? " same" : ""}"><i>${clock(l.t)}</i><b class="g ${g.cls}">${g.g}</b><span>${esc(l.text)}</span></div>`; }).join("");
      }
      el.querySelector(".q")!.textContent = NEEDS_YOU.has(st) ? s.msg || "" : "";
      el.querySelector(".act")!.textContent = chip || verb?.label || "";
      el.style.setProperty("--pc", s.color ?? "transparent");
      el.querySelector(".res")!.innerHTML = resultsLine(s).split(" · ").filter(Boolean).map((p) => (p.endsWith("✗") ? `<span class="ko">${esc(p)}</span>` : esc(p))).join(" · ");
      if (av) renderAgents(el, s.stage, av, asel, now());
      kids.push(el);
    }
    sync(ge, kids);
    groupNodes.push(ge);
  }
  sync(box, groupNodes);
  for (const el of box.querySelectorAll<HTMLElement>(".term")) fitTerm(el);
}

export function bindCards(): void {
  const box = $("#cards")!;
  let lw = { sum: 0, stepped: false, last: 0 };
  box.addEventListener("wheel", (e) => {
    if (ui.portrait || cpage.pages < 2) return;
    const t = now(), dy = e.deltaY * (e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1);
    if (t - lw.last > SWIPE.quietMs) lw = { sum: 0, stepped: false, last: t };
    lw.last = t;
    if (Math.abs(dy) <= 30) return;
    if (box.classList.contains("scroll") && (dy < 0 ? box.scrollTop > 0 : box.scrollTop + box.clientHeight < box.scrollHeight - 1)) { lw.stepped = true; return; } // native scroll; this gesture never pages
    e.preventDefault();
    if (lw.stepped) return;
    lw.sum += dy;
    if (Math.abs(lw.sum) >= SWIPE.wheel) { selectProject(cpage.i + Math.sign(lw.sum)); renderCards(); lw.stepped = true; }
  }, { passive: false });
  let down: { x: number; y: number; id: number } | null = null, swipedAt = -Infinity, wg = { sum: 0, paged: false, last: 0 };
  box.addEventListener("pointerdown", (e) => {
    if (!ui.portrait || e.pointerType === "mouse") return;
    if (down) { down = null; return; }
    down = { x: e.clientX, y: e.clientY, id: e.pointerId }; swipedAt = -Infinity;
  });
  box.addEventListener("pointercancel", () => { down = null; });
  box.addEventListener("pointerup", (e) => {
    if (!down || e.pointerId !== down.id) return;
    const dx = e.clientX - down.x, dy = e.clientY - down.y; down = null;
    if (Math.abs(dx) >= SWIPE.px && Math.abs(dx) > 2 * Math.abs(dy)) { swipedAt = Date.now(); step(dx < 0 ? 1 : -1); }
  });
  box.addEventListener("click", (e) => {
    const swallow = Date.now() - swipedAt < 500; swipedAt = -Infinity;
    if (swallow) { e.stopPropagation(); e.preventDefault(); }
  }, true);
  box.addEventListener("wheel", (e) => {
    if (!ui.portrait || Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
    e.preventDefault();
    const t = now();
    if (t - wg.last > SWIPE.quietMs) wg = { sum: 0, paged: false, last: t };
    wg.last = t;
    if (wg.paged) return;
    wg.sum += e.deltaX;
    if (Math.abs(wg.sum) >= SWIPE.wheel) { step(wg.sum > 0 ? 1 : -1); wg.paged = true; }
  }, { passive: false });
}
