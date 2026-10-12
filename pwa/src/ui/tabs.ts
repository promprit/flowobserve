/** Spec 2026-10-08 §2: the tab strip under the KPI strip. Portrait: a session per tab; landscape: a project per tab. */
import { needsYou, type LayoutSession } from "../layout";
import { go as pagerGo, pager, pp } from "../pager";
import { vscodeFor } from "../edition";
import { eff } from "../select";
import { store, ui } from "../state";
import { landscapeTabs, portraitTabs } from "../tabs";
import { $, nav, safeOpenUrl } from "../util";
import { cpage, renderCards, selectProject } from "./cards";

const need = (id: string) => { const s = store.sessions.get(id); return !!s && needsYou(s, eff(s)); };
let shown: { id: string }[] = [];
let sig = "", lastOn: string | null = null, lastW = 0;

/** The current tab: the focused session (portrait) or the shown page's project (landscape). */
const current = (): string | null => (ui.portrait ? pager.focus : cpage.list[cpage.i]?.groups[0]?.key ?? null);

/** The project the open link opens: the current session's (portrait) or the shown page's first session (landscape). */
function openTarget(): string | null {
  const id = ui.portrait ? pager.focus : cpage.list[cpage.i]?.groups[0]?.sessions[0]?.id;
  const s = id ? store.sessions.get(id) : undefined;
  return s && vscodeFor(s) ? safeOpenUrl(s.openUrl) : null;
}

export function renderTabs(lay: LayoutSession[]): void {
  const el = $("#tabs"); if (!el) return;
  const tabs = ui.portrait ? portraitTabs(lay, pp.order, need) : landscapeTabs(cpage.fleet, need), on = current();
  shown = tabs;
  el.hidden = !tabs.length;
  const w = el.querySelector<HTMLElement>(".tl")!.clientWidth, next = (ui.portrait ? "p" : "l") + "|" + on + "|" + w + "|" + tabs.map((t) => `${t.id}\u0001${t.name}\u0001${t.num}\u0001${t.need ? 1 : 0}`).join("\u0002");
  if (next === sig) return;
  sig = next;
  el.setAttribute("aria-label", ui.portrait ? "Sessions" : "Projects");
  const tl = el.querySelector<HTMLElement>(".tl")!, fid = document.activeElement instanceof HTMLElement && tl.contains(document.activeElement) ? document.activeElement.dataset.id : undefined;
  const hadFocus = fid && fid === lastOn && on ? on : fid; // focus on the old current tab follows the selection
  tl.setAttribute("aria-label", el.getAttribute("aria-label")!);
  tl.replaceChildren(...tabs.map((t, i) => {
    const b = document.createElement("button");
    b.type = "button"; b.className = "tab" + (t.id === on ? " on" : "") + (t.need ? " need" : "");
    b.tabIndex = t.id === on ? 0 : -1; b.setAttribute("role", "tab"); b.setAttribute("aria-selected", String(t.id === on));
    b.dataset.id = t.id; b.dataset.name = t.name;
    b.title = t.num ? `${t.name} ${t.num}` : t.name;
    if (i < 9) { b.setAttribute("aria-keyshortcuts", "Meta+" + (i + 1)); b.title += ` · ⌘${i + 1}`; }
    const nm = document.createElement("span"); nm.className = "nm"; nm.textContent = t.name; b.append(nm);
    if (t.num) { const no = document.createElement("span"); no.className = "no"; no.textContent = String(t.num); b.append(no); }
    if (i < 9) { const kb = document.createElement("span"); kb.className = "kb"; kb.textContent = `⌘${i + 1}`; b.append(kb); }
    const nd = document.createElement("i"); nd.className = "nd"; b.append(nd);
    return b;
  }));
  if (hadFocus) [...tl.querySelectorAll<HTMLElement>(".tab")].find((c) => c.dataset.id === hadFocus)?.focus({ preventScroll: true });
  if (on !== lastOn || w !== lastW) {
    lastOn = on; lastW = w;
    tl.querySelector<HTMLElement>(".tab.on")?.scrollIntoView?.({ block: "nearest", inline: "nearest", behavior: ui.reduce ? "auto" : "smooth" });
  }
}

/** Select a tab on the board (portrait: focus the session; landscape: show the project). */
export function selectTab(id: string): void {
  if (ui.portrait) { if (store.sessions.has(id)) { pagerGo(id); renderCards(); } return; }
  const i = cpage.fleet.findIndex((p) => p.groups[0]?.key === id);
  if (i >= 0) { selectProject(i); renderCards(); }
}

/** ⌘1–⌘9: the nth tab; 9 is the last tab when there are more than nine. False when no such tab. */
export function selectTabAt(n: number): boolean {
  const idx = n === 9 && shown.length > 9 ? shown.length - 1 : n - 1, t = shown[idx];
  if (!t) return false;
  selectTab(t.id);
  return true;
}

export function bindTabs(): void {
  const el = $("#tabs"); if (!el) return;
  el.querySelector(".tl")!.addEventListener("click", (e) => {
    const id = (e.target as HTMLElement).closest<HTMLElement>(".tab")?.dataset.id;
    if (!id) return;
    selectTab(id);
  });
  const open = () => { const u = openTarget(); if (u && store.link === "live") nav.go(u); };
  const a = el.querySelector<HTMLElement>(".open")!;
  a.addEventListener("click", open);
  a.addEventListener("keydown", (e) => {
    const k = (e as KeyboardEvent).key;
    if (k === " ") e.preventDefault();
    if (k === "Enter" || k === " ") { e.stopPropagation(); open(); }
  });
}

export function resetTabs(): void { sig = ""; lastOn = null; lastW = 0; }
