import "./reader.css";
import { pager } from "../pager";
import { eff } from "../select";
import { type CSession, hooks, now, store } from "../state";
import { $, dur, esc } from "../util";
import type { FetchFn } from "./drawer";
import { type MdOutline, renderMd } from "./md";
import { jump as jumpSession } from "./verbs";

type Kind = "spec" | "plan";
type Loaded = { html: string; outline: MdOutline[] } | "none" | "error";

const KINDS: Kind[] = ["spec", "plan"];
const TIMEOUT_MS = 5000;

let seq = 0;
let open = false;
let sid = "";
let kind: Kind = "plan";
let docs: Partial<Record<Kind, Loaded>> = {};
let prevFocus: HTMLElement | null = null;

export const readerOpen = (): boolean => open;
const panel = () => $("#reader");
const backdrop = () => $("#reader-bd");
const other = (k: Kind): Kind => (k === "spec" ? "plan" : "spec");

async function load(id: string, k: Kind, fetchFn: FetchFn): Promise<Loaded> {
  try {
    const r = await fetchFn(`${store.spendBase}/api/doc?session=${encodeURIComponent(id)}&kind=${k}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (r.ok) {
      const j = (await r.json()) as { markdown?: unknown };
      return typeof j.markdown === "string" ? renderMd(j.markdown) : "error";
    }
    return (r as { status?: number }).status === 404 ? "none" : "error";
  } catch {
    return "error";
  }
}

function paint(): void {
  const el = panel();
  const s = store.sessions.get(sid);
  if (!el || !s) return;
  const d = docs[kind];
  const a = document.activeElement as HTMLElement | null;
  const refocus = a && el.contains(a) ? (a.dataset.tab ? `[data-tab="${a.dataset.tab}"]` : a.dataset.id ? `[data-id="${a.dataset.id}"]` : a.className ? `.${a.classList[0]}` : "") : "";
  const tab = (k: Kind) => `<button data-tab="${k}" class="${k === kind ? "on" : ""}"${docs[k] === "none" || docs[k] === "error" ? ' disabled aria-disabled="true"' : ""}>${k.toUpperCase()}</button>`;
  const wait = eff(s) === "waiting" ? `<span class="rd-w">waiting ${dur(now() - (s.since || now()))}</span>` : "";
  let toc = "", body: string;
  if (d === undefined) body = '<p class="rd-note">Loading…</p>';
  else if (d === "none") body = `<p class="rd-note">No ${kind} yet</p>`;
  else if (d === "error") body = `<p class="rd-note">Couldn't load the ${kind}</p>`;
  else {
    body = d.html;
    toc = d.outline.map((o) => `<button data-id="${o.id}" class="l${o.level}">${esc(o.text)}</button>`).join("");
  }
  const note = KINDS.filter((k) => docs[k] === "none").map((k) => `<span class="rd-none">No ${k} yet</span>`).join("");
  el.innerHTML = `<div class="rd-h"><span class="rd-tabs">${KINDS.map(tab).join("")}</span><b class="rd-n">${esc(s.name)}</b>${wait}${note}<button class="rd-x" aria-label="Close">×</button></div>` +
    `<div class="rd-b"><nav class="rd-toc">${toc}</nav><article class="rd-doc" tabindex="0">${body}</article></div>` +
    '<div class="rd-f"><button class="rd-go">Jump to approve ↵</button></div>';
  if (refocus) el.querySelector<HTMLElement>(refocus)?.focus();
}

export async function openReader(id: string, k: Kind, fetchFn: FetchFn = (u, i) => fetch(u, i), onMissing?: () => void): Promise<void> {
  const my = ++seq;
  const el = panel();
  if (!el || !store.sessions.has(id)) return;
  if (!open) prevFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  open = true; sid = id; kind = k; docs = {};
  el.hidden = false;
  const bd = backdrop();
  if (bd) bd.hidden = false;
  paint();
  el.querySelector<HTMLElement>(".rd-go")?.focus();
  if (!store.spendBase) { if (onMissing) { closeReader(); onMissing(); return; } docs.spec = "none"; docs.plan = "none"; paint(); return; }
  docs[k] = await load(id, k, fetchFn);
  if (my !== seq) return;
  if (docs[k] === "none" && onMissing) { closeReader(); onMissing(); return; }
  paint();
  const o = other(k), have = store.sessions.get(id)?.docs?.[o];
  if (have === 0) { docs[o] = "none"; paint(); return; }
  docs[o] = await load(id, o, fetchFn);
  if (my === seq) paint();
}

export function closeReader(): void {
  seq++;
  open = false;
  const el = panel();
  if (el) el.hidden = true;
  const bd = backdrop();
  if (bd) bd.hidden = true;
  const back = prevFocus;
  prevFocus = null;
  if (back?.isConnected) back.focus();
}

function jump(): void {
  const s: CSession | undefined = store.sessions.get(sid);
  if (s) jumpSession(s);
}

function switchTab(k: Kind): void {
  if (docs[k] === "none" || docs[k] === "error") return;
  kind = k;
  paint();
}

function onKey(e: KeyboardEvent): void {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (open) {
    e.stopImmediatePropagation();
    const a = document.activeElement;
    const onBtn = a instanceof HTMLElement && a.tagName === "BUTTON" && !!panel()?.contains(a);
    if (e.key === "Tab") {
      const f = [...(panel()?.querySelectorAll<HTMLElement>("button:not([disabled]), .rd-doc") ?? [])];
      if (!f.length) { e.preventDefault(); return; }
      const i = a instanceof HTMLElement ? f.indexOf(a) : -1;
      const n = f.length;
      f[i < 0 ? 0 : (i + (e.shiftKey ? n - 1 : 1)) % n].focus();
    } else if (e.key === "Escape") closeReader();
    else if (e.key === "Enter") { if (onBtn) return; jump(); }
    else if (e.key === "s" || e.key === "S") switchTab("spec");
    else if (e.key === "p" || e.key === "P") switchTab("plan");
    else return;
    e.preventDefault();
    return;
  }
  if (e.key !== "r" && e.key !== "R") return;
  const a = document.activeElement;
  if (a instanceof HTMLElement && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName))) return;
  const d = store.sessions.get(pager.focus ?? "")?.docs;
  const k: Kind | null = d && d.plan > 0 ? "plan" : d && d.spec > 0 ? "spec" : null;
  if (k && pager.focus) { e.preventDefault(); void openReader(pager.focus, k); }
}

export function bindReader(): void {
  let el = panel();
  if (!el) {
    el = document.createElement("div");
    el.id = "reader";
    el.hidden = true;
    document.body.appendChild(el);
  }
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-modal", "true");
  el.setAttribute("aria-label", "Spec and plan reader");
  let bd = backdrop();
  if (!bd) {
    bd = document.createElement("div");
    bd.id = "reader-bd";
    bd.hidden = true;
    document.body.insertBefore(bd, el);
  }
  bd.addEventListener("click", closeReader);
  el.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    const tab = t.closest<HTMLElement>("[data-tab]"), item = t.closest<HTMLElement>(".rd-toc [data-id]");
    if (t.closest(".rd-x")) closeReader();
    else if (t.closest(".rd-go")) jump();
    else if (tab) switchTab(tab.dataset.tab as Kind);
    else if (item) el!.querySelector(`.rd-doc [id="${item.dataset.id}"]`)?.scrollIntoView({ block: "start" });
  });
  window.removeEventListener("keydown", onKey, true);
  window.addEventListener("keydown", onKey, true);
  hooks.openReader = (id, k, miss) => void openReader(id, k, undefined, miss);
}
