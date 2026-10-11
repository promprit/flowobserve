/** Card agents row (spec 2026-10-08 agents view, PWA; prototype P:857-900). DOM built with createElement + textContent only:
 *  no agent field ever reaches innerHTML, a style string or an attribute (colours come from the fixed model map). */
import { AWORD, FRESH_MS, MAXL, MODELW, SEL_MS, actLine, agentHex, detailRows, modelHex, needsLook, pillModels, summaryParts, tallyParts, type AgentView, type Lineage, type Part } from "../agents";
import { HEX } from "../config";
import { manual, pager } from "../pager";
import { changed, now, ui } from "../state";

const sigs = new WeakMap<Element, string>(), tcs = new WeakMap<Element, number>(), maps = new WeakMap<Element, Map<string, HTMLElement>>();
const kids = (box: Element): Map<string, HTMLElement> => { let m = maps.get(box); if (!m) { m = new Map(); maps.set(box, m); } return m; };
const grow = (el: HTMLElement, frames: Keyframe[], ms: number) => { if (!ui.reduce) el.animate?.(frames, { duration: ms, easing: "cubic-bezier(.22,1,.36,1)" }); };
const order = (box: HTMLElement, want: HTMLElement[]) => want.forEach((el, i) => { if (box.children[i] !== el) box.insertBefore(el, box.children[i] ?? null); });

/** Text runs → child nodes (bold → <b>, coloured → <span>); skipped when nothing changed. */
export function paintParts(el: HTMLElement, parts: Part[]): void {
  const sig = parts.map((p) => `${p.bold ? 1 : 0}${p.color ?? ""}\u0001${p.text}`).join("\u0002");
  if (sigs.get(el) === sig) return;
  sigs.set(el, sig);
  el.replaceChildren(...parts.map((p) => {
    if (!p.bold && !p.color) return document.createTextNode(p.text);
    const n = document.createElement(p.bold ? "b" : "span");
    n.textContent = p.text;
    if (p.color) n.style.color = p.color;
    return n;
  }));
}

/** Tap toggles; hover (toggle = false) only selects. Selecting another session's agent focuses that session. */
export function selectAgent(sid: string, aid: string | null, toggle = true): void {
  const cur = ui.agentSel;
  if (!aid || (toggle && cur && cur.sid === sid && cur.aid === aid)) ui.agentSel = null;
  else { ui.agentSel = { sid, aid, at: now() }; if (pager.focus !== sid) manual(sid); }
  changed();
}

export function clearStaleSel(t: number): void {
  const s = ui.agentSel;
  if (s && t - s.at > SEL_MS) { ui.agentSel = null; changed(); }
}

/** The selected lineage when it belongs to this session and is still visible. */
export function selected(v: AgentView | null, sid: string): Lineage | null {
  const s = ui.agentSel;
  if (!v || !s || s.sid !== sid) return null;
  const L = v.byId.get(s.aid);
  return L && L.vis ? L : null;
}

function paintPip(p: HTMLElement, L: Lineage, sel: boolean): void {
  const h = L.head, pm = pillModels(L), cl = `pip d${L.depth} ${h.state}${pm.length > 1 ? " ln" : ""}${sel ? " sel" : ""}`;
  if (p.className !== cl) p.className = cl;
  p.style.setProperty("--m", agentHex(h));
  const sg = pm.join() + h.state;
  if (sigs.get(p) === sg) return;
  sigs.set(p, sg);
  p.replaceChildren(...(pm.length > 1 ? pm.map((m, j) => {
    const i = document.createElement("i"), last = j === pm.length - 1;
    i.style.setProperty("background", last ? "var(--m)" : modelHex(m));
    i.style.setProperty("opacity", last ? "1" : "0.45");
    return i;
  }) : []));
}

/** One light tick per tool call while working (never the first sight, never under reduced motion). */
function tick(p: HTMLElement, L: Lineage): void {
  const h = L.head, was = tcs.get(p);
  if (was === undefined || h.toolCalls <= was) { if (was === undefined) tcs.set(p, h.toolCalls); return; }
  tcs.set(p, h.toolCalls);
  if (h.state === "working") grow(p, [{ transform: "scale(1.25)" }, { transform: "scale(1)" }], 450);
}

export function bindAgents(el: HTMLElement, sid: string): void {
  const hit = (sel: string) => (e: Event) => {
    const p = (e.target as HTMLElement).closest<HTMLElement>(sel);
    if (!p) return;
    e.stopPropagation();
    selectAgent(sid, p.dataset.aid ?? null);
  };
  el.querySelector(".ag .pips")!.addEventListener("click", hit(".pip[data-aid]"));
  el.querySelector(".ag .lanes")!.addEventListener("click", hit(".lane[data-aid]"));
  el.querySelector(".agd")!.addEventListener("click", (e) => { e.stopPropagation(); selectAgent(sid, null); });
}

function paintDetail(d: HTMLElement, L: Lineage | null, t: number): void {
  if (!L) { if (d.firstChild) d.replaceChildren(); sigs.delete(d); return; }
  const D = detailRows(L, t), sig = JSON.stringify(D);
  if (sigs.get(d) === sig) return;
  sigs.set(d, sig);
  const div = (cls: string) => { const e = document.createElement("div"); e.className = cls; return e; };
  const span = (text: string, color?: string, cls?: string) => { const e = document.createElement("span"); e.textContent = text; if (color) e.style.color = color; if (cls) e.className = cls; return e; };
  const ah = div("ah");
  ah.append(span(D.name.text, D.name.color), span(D.word.text, D.word.color), span("✕", undefined, "x"));
  const at = div("at"); at.textContent = D.task;
  const an = div("an");
  for (const c of D.cells) {
    const w = document.createElement("div"), b = document.createElement("b"), i = document.createElement("i");
    b.textContent = c.v; if (c.color) b.style.color = c.color; i.textContent = c.k;
    w.append(b, i); an.append(w);
  }
  const out: HTMLElement[] = [ah, at, an];
  if (D.chain.length) { const ac = div("ac"); paintParts(ac, D.chain); out.push(ac); }
  const ap = div("ap"); ap.textContent = D.by; out.push(ap);
  d.replaceChildren(...out);
}

export function renderAgents(el: HTMLElement, stage: number, v: AgentView, sel: Lineage | null, t: number): void {
  const pips = el.querySelector<HTMLElement>(".ag .pips")!, lanes = el.querySelector<HTMLElement>(".ag .lanes")!;
  const pm = kids(pips), wp: HTMLElement[] = [];
  for (const L of v.order) {
    let p = pm.get(L.id);
    if (!p) {
      p = document.createElement("b"); p.dataset.aid = L.id; pm.set(L.id, p);
      if (t - L.chain[0].spawnedAt < FRESH_MS) grow(p, [{ transform: "scale(0)", opacity: 0 }, { transform: "scale(1)", opacity: 1 }], 700);
    }
    paintPip(p, L, sel === L);
    p.title = `${L.name} · ${L.head.model ? MODELW[L.head.model] : "NO MODEL"} · ${AWORD[L.head.state]}`;
    tick(p, L); wp.push(p);
  }
  for (const [id, p] of pm) if (!wp.includes(p)) { p.remove(); pm.delete(id); }
  order(pips, wp);
  const lm = kids(lanes), wl: HTMLElement[] = [];
  for (const L of v.order.slice(0, MAXL)) {
    const h = L.head;
    let r = lm.get(L.id);
    if (!r) {
      r = document.createElement("div"); r.dataset.aid = L.id;
      r.append(document.createElement("b"), ...["n", "t", "r"].map((c) => { const s = document.createElement("span"); s.className = c; return s; }));
      lm.set(L.id, r);
      if (t - L.chain[0].spawnedAt < FRESH_MS) grow(r, [{ opacity: 0, transform: "translateX(calc(var(--u) * -24))" }, { opacity: 1, transform: "none" }], 700);
    }
    const cl = `lane d${L.depth} ${h.state}${sel === L ? " sel" : ""}`;
    if (r.className !== cl) r.className = cl;
    const pp = r.children[0] as HTMLElement, n = r.children[1] as HTMLElement, tt = r.children[2] as HTMLElement, rr = r.children[3] as HTMLElement;
    paintPip(pp, L, false); tick(pp, L);
    if (n.textContent !== L.name) n.textContent = L.name;
    n.style.color = modelHex(h.model);
    const tx = h.task ?? ""; if (tt.textContent !== tx) tt.textContent = tx;
    const rx = actLine(L, t); if (rr.textContent !== rx) rr.textContent = rx;
    rr.style.color = needsLook(h.state) ? agentHex(h) : h.state === "done" ? HEX.t3 : "";
    wl.push(r);
  }
  for (const [id, r] of lm) if (!wl.includes(r)) { r.remove(); lm.delete(id); }
  order(lanes, wl);
  const more = v.order.length > MAXL ? `+${v.order.length - MAXL} MORE` : "";
  if (lanes.dataset.more !== more) lanes.dataset.more = more;
  paintParts(el.querySelector<HTMLElement>(".ag .as")!, summaryParts(v, t));
  paintParts(el.querySelector<HTMLElement>(".ag .atl")!, stage >= 5 && v.tally.spawned ? tallyParts(v.tally) : []);
  paintDetail(el.querySelector<HTMLElement>(".agd")!, sel, t);
}
