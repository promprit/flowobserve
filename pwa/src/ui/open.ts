import "./open.css";
import { PALETTE, nameColor, openUrl } from "@fo/shared";
import type { Folder, Project } from "@fo/shared";
import { saveColor } from "../color";
import { go, helperUrl, itermOf, nameProblem } from "../helper";
import { type CSession, store } from "../state";
import { jumpTarget } from "./verbs";
import { $, esc, nav, safeOpenUrl } from "../util";
import { canHelper } from "../edition";
import { closeDrawer } from "./drawer";

export type Action = { kind: "jump" | "restore" | "new" | "vscode"; url: string | null; n?: number; title?: string };

const MAX_RESUME = 12;
const SPLITS = 4;
const NO_TOKEN = "Re-run scripts/install.sh to enable opening sessions";
const ROOT_MISSING = "Projects folder not found — SSD mounted?";

let filter = "", lastList = "", lastHint = "", lastProjects = "", creating = false, saving = false, creatingTimer: ReturnType<typeof setTimeout> | undefined;
const expanded = new Set<string>();
let picking: string | null = null, pickErr: string | null = null, newColor: string | null = null;
const override = new Map<string, string>();
const colorOf = (p: Project): string => override.get(p.key) ?? p.color;

const mainFolder = (p: Project): Folder => p.folders.find((f) => !f.worktree) ?? p.folders[0];
const ordered = (p: Project): Folder[] => [...p.folders].sort((a, b) => Number(!!a.worktree) - Number(!!b.worktree));
const isLive = (f: Folder): boolean => !!f.live && store.sessions.has(f.live);
const liveUrl = (f: Folder): string | null => {
  const s = f.live ? store.sessions.get(f.live) : undefined;
  return s ? jumpTarget(s) : null;
};

const restoreAction = (f: Folder, color: string): Action => {
  const ids = f.restore.slice(0, MAX_RESUME).map((r) => r.id);
  return { kind: "restore", url: helperUrl.open(f.rel, ids, false, f.root ?? null, color), n: ids.length };
};

/** vscode:// URL for a folder under its create root; same encoding as shared toWire's openUrl. */
export function vscodeFolderUrl(f: Folder): string | null {
  const root = (store.createRoots ?? []).find((r) => r.label === (f.root ?? "projects"));
  if (!root) return null;
  return safeOpenUrl(openUrl(`${root.path}/${f.rel}`));
}

const vscodeAction = (f: Folder): Action => ({ kind: "vscode", url: vscodeFolderUrl(f) });

export function bestAction(p: Project): Action {
  if (!canHelper()) return vscodeAction(mainFolder(p));
  const live = ordered(p).find(isLive);
  if (live) return { kind: "jump", url: liveUrl(live) };
  const m = mainFolder(p);
  return m.restore.length ? restoreAction(m, colorOf(p)) : { kind: "new", url: helperUrl.open(m.rel, [], false, m.root ?? null, colorOf(p)) };
}

export function gridHint(sessions: Iterable<CSession>): string {
  const live: { tab: string; at: number; pane: string }[] = [];
  for (const s of sessions) {
    const id = s.host === "iterm" ? itermOf(s.jumpUrl) : null;
    const m = id ? /^(w\d+t\d+)(p\d+):/.exec(id) : null;
    if (m) live.push({ tab: m[1], pane: m[2], at: s.lastEventAt });
  }
  if (!live.length) return "Opens in a new iTerm2 window";
  const tab = live.reduce((a, b) => (b.at > a.at ? b : a)).tab;
  const used = new Set(live.filter((x) => x.tab === tab).map((x) => x.pane)).size;
  return used >= SPLITS ? "Tab full · next opens in a new tab" : `${used} of ${SPLITS} splits used · next opens here, then a new tab`;
}

const NEW_WT = "New session in a fresh worktree from main";

const newWt = (f: Folder, color: string): Action => ({ kind: "new", url: helperUrl.open(f.rel, [], true, f.root ?? null, color), title: NEW_WT });

const btn = (a: Action): string => {
  const label = a.kind === "jump" ? "Jump" : a.kind === "restore" ? `Restore ${a.n}` : a.kind === "vscode" ? "Open" : "New";
  const off = (a.kind !== "vscode" && !store.helperToken) || !a.url;
  return `<button type="button" class="op-b ${a.kind}"${off ? " disabled" : ""} data-url="${esc(a.url ?? "")}"${a.title ? ` title="${esc(a.title)}"` : ""}>${esc(label)}</button>`;
};

function folderLine(f: Folder, color: string): string {
  const live = isLive(f);
  const acts: Action[] = !canHelper()
    ? [vscodeAction(f)]
    : live
    ? [{ kind: "jump", url: liveUrl(f) }, ...(f.worktree ? [] : [newWt(f, color)])]
    : [...(f.restore.length ? [restoreAction(f, color)] : []), { kind: "new", url: helperUrl.open(f.rel, [], false, f.root ?? null, color) }];
  const label = f.worktree ? `wt ${f.worktree}` : "main";
  return `<div class="op-f" data-rel="${esc(f.rel)}"><span class="op-w">${live ? '<i class="op-live"></i>' : ""}${esc(label)}</span>${acts.map(btn).join("")}</div>`;
}

const dot = (key: string, c: string): string =>
  store.helperToken ? `<button type="button" class="op-dot" data-key="${esc(key)}" style="--pc:${esc(c)}" aria-label="Colour for ${esc(key)}" aria-expanded="${picking === key}"></button>` : "";

function pickRow(key: string, current: string): string {
  if (picking === key) {
    const sw = PALETTE.map((c) => `<button type="button" class="op-sw${c === current ? " on" : ""}" data-c="${c}" style="--sw:${c}" aria-label="${c}" aria-pressed="${c === current}"></button>`).join("");
    return `<div class="op-pick" role="group" aria-label="Choose colour">${sw}<button type="button" class="op-sw reset" data-c="" aria-label="Reset colour">Reset</button></div>`;
  }
  return pickErr === key ? `<p class="op-pick-err">Colour not saved</p>` : "";
}

function projectRows(p: Project, indent: boolean): string {
  const o = expanded.has(p.key), m = mainFolder(p), c = colorOf(p);
  const head = `<div class="op-row${indent ? " in" : ""}${p.plain ? " plain" : ""}" data-key="${esc(p.key)}" style="--pc:${esc(c)}">${dot(p.key, c)}<span class="op-car">${o ? "▾" : "▸"}</span><span class="op-n">${esc(p.name)}${p.plain ? '<span class="op-tag">no git</span>' : ""}</span>${o ? "" : btn(bestAction(p)) + (canHelper() && !m.worktree && isLive(m) ? btn(newWt(m, c)) : "")}</div>`;
  return head + pickRow(p.key, c) + (o ? ordered(p).map((f) => folderLine(f, c)).join("") : "");
}

function list(): string {
  if (store.rootMissing) return `<p class="op-note">${esc(ROOT_MISSING)}</p>`;
  const q = filter.trim().toLowerCase();
  const ps = store.projects.filter((p) => !q || p.name.toLowerCase().includes(q) || (p.group ?? "").toLowerCase().includes(q));
  const out: string[] = [], seen = new Set<string>();
  for (const p of ps) {
    if (!p.group) { out.push(projectRows(p, false)); continue; }
    if (seen.has(p.group)) continue;
    seen.add(p.group);
    const self = store.projects.find((x) => x.key === p.group && x.group === p.group);
    const kids = ps.filter((x) => x.group === p.group && x !== self), o = expanded.has(`g:${p.group}`) || !!q;
    out.push(`<div class="op-row" data-group="${esc(p.group)}">${self ? dot(self.key, colorOf(self)) : ""}<span class="op-car">${o ? "▾" : "▸"}</span><span class="op-n">${esc(p.group)}</span><span class="op-sub">group · ${esc(kids.map((k) => k.name).join(" · "))}</span>${self ? btn(bestAction(self)) : ""}</div>${self ? pickRow(self.key, colorOf(self)) : ""}`);
    if (o) out.push(...kids.map((k) => projectRows(k, true)));
  }
  return (out.join("") || `<p class="op-note">No projects match</p>`) + (store.helperToken || !canHelper() ? "" : `<p class="op-note">${esc(NO_TOKEN)}</p>`);
}

const ROOT_GONE = (label: string): string => `${label} not found — SSD mounted?`;

function newRow(): string {
  if (!canHelper()) return "";
  const roots = store.createRoots ?? [];
  if (!roots.length) return "";
  const opts = roots.map((r) => `<option value="${esc(r.label)}"${r.exists ? "" : " disabled"}>${esc(r.label)}</option>`).join("");
  return `<form class="op-new" novalidate><span class="op-new-h">New project</span><input class="op-new-name" type="text" placeholder="project-name" aria-label="New project name" autocomplete="off" spellcheck="false"><div class="op-new-sw" style="--pc:transparent">${PALETTE.map((c) => `<button type="button" class="op-sw" data-c="${c}" style="--sw:${c}" aria-label="${c}" aria-pressed="false"></button>`).join("")}</div><div class="op-new-sub"><select class="op-new-root" aria-label="Folder">${opts}</select><button type="submit" class="op-new-create" disabled>Create</button></div><p class="op-new-path"></p><p class="op-new-msg" aria-live="polite"></p></form>`;
}

/** A folder named `name` already sits directly in the chosen root (null root = the projects folder). */
const taken = (name: string, root: string, first: string): boolean =>
  store.projects.some((p) => p.folders.some((f) => !f.worktree && f.rel === name && (f.root ?? first) === root));

function paintNew(): void {
  const form = $("#sheet")!.querySelector<HTMLFormElement>(".op-new");
  if (!form) return;
  const name = form.querySelector<HTMLInputElement>(".op-new-name")!.value;
  const sel = form.querySelector<HTMLSelectElement>(".op-new-root")!;
  const create = form.querySelector<HTMLButtonElement>(".op-new-create")!;
  const path = form.querySelector<HTMLElement>(".op-new-path")!, msg = form.querySelector<HTMLElement>(".op-new-msg")!;
  const roots = store.createRoots ?? [], root = roots.find((r) => r.label === sel.value);
  const problem = name ? nameProblem(name, taken(name, sel.value, roots[0].label)) : null;
  const gone = root && !root.exists ? root : undefined;
  const text = problem ?? (gone ? ROOT_GONE(gone.label) : "");
  const exists = problem !== null && !nameProblem(name);
  const swRow = form.querySelector<HTMLElement>(".op-new-sw")!;
  swRow.style.setProperty("--pc", newColor ?? (name && !nameProblem(name) ? nameColor(name) : "transparent"));
  swRow.querySelectorAll<HTMLElement>(".op-sw").forEach((b) => { const on = b.dataset.c === newColor; b.classList.toggle("on", on); b.setAttribute("aria-pressed", String(on)); });
  msg.textContent = text;
  msg.className = `op-new-msg ${!text ? "" : exists ? "note" : "err"}`.trim();
  path.textContent = name && !problem && root ? `${root.path}/${name}` : "";
  if (creating) { create.textContent = "Creating…"; create.disabled = true; return; }
  create.textContent = "Create";
  create.disabled = !name || problem !== null || !root?.exists || !store.helperToken;
}

function submitNew(): void {
  const form = $("#sheet")!.querySelector<HTMLFormElement>(".op-new");
  if (!form || creating) return;
  const create = form.querySelector<HTMLButtonElement>(".op-new-create")!;
  if (create.disabled) return;
  const root = form.querySelector<HTMLSelectElement>(".op-new-root")!.value, name = form.querySelector<HTMLInputElement>(".op-new-name")!.value;
  const u = helperUrl.newProject(root, name);
  if (!u) return;
  const key = root === (store.createRoots ?? [])[0]?.label ? name : `${root}:${name}`;
  creating = true; paintNew();
  const fire = (): void => {
    saving = false;
    if (!go(u)) { creating = false; paintNew(); return; }
    clearTimeout(creatingTimer);
    creatingTimer = setTimeout(() => { creating = false; paintNew(); }, 5000);
    closeSheet();
  };
  if (newColor) { saving = true; void saveColor(key, newColor).finally(fire); } else fire();
}

/** Open state lives in the DOM so the spend drawer can close the sheet without importing this module. */
export const sheetOpen = (): boolean => !$("#sheet")!.hidden;

function paintList(): void {
  const s = $("#sheet")!;
  const l = s.querySelector(".op-list"), h = s.querySelector(".op-hint");
  const html = list(), hint = canHelper() ? gridHint(store.sessions.values()) : "";
  if (l && html !== lastList) { l.innerHTML = html; lastList = html; }
  if (h && hint !== lastHint) { h.textContent = hint; lastHint = hint; }
}

function pick(key: string, color: string | null): void {
  picking = null; pickErr = null;
  const shown = color ?? store.projects.find((p) => p.key === key)?.base ?? null;
  if (shown) override.set(key, shown); else override.delete(key);
  paintList();
  void saveColor(key, color).then((ok) => {
    if (ok || (override.get(key) ?? null) !== shown) return;
    override.delete(key); pickErr = key; paintList();
  });
}

export function renderSheet(): void {
  for (const [k, c] of override) if (store.projects.find((p) => p.key === k)?.color === c) override.delete(k);
  $("#open-btn")!.hidden = !store.projects.length && !store.rootMissing;
  const sig = store.projects.map((p) => p.key).join("\0");
  if (sig !== lastProjects) { lastProjects = sig; if (creating && !saving) { creating = false; clearTimeout(creatingTimer); } }
  if (sheetOpen()) {
    paintList();
    paintNew();
  }
}

export function openSheet(): void {
  closeDrawer();
  filter = ""; lastList = lastHint = ""; picking = pickErr = null; newColor = null;
  const s = $("#sheet")!;
  s.innerHTML = `<div class="op-h"><b>Open a project</b><button type="button" class="op-x" aria-label="Close">×</button></div>${newRow()}<input class="op-q" type="text" placeholder="type to filter…" aria-label="Filter projects" autocomplete="off" spellcheck="false"><div class="op-list"></div><div class="op-hint"></div>`;
  s.hidden = false;
  paintList();
  paintNew();
  s.querySelector<HTMLInputElement>(".op-q")!.focus();
}

export function closeSheet(): void {
  const s = $("#sheet")!;
  const had = !s.hidden;
  s.hidden = true;
  if (had) $("#open-btn")?.focus();
}

export function bindOpen(): void {
  // The button sits inside #loop, whose pointer capture would retarget the click to #loop (as #inspect avoids too).
  document.addEventListener("pointerdown", (e) => { if ((e.target as Element).closest?.("#open-btn")) e.stopPropagation(); }, true);
  document.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    if (t.closest("#open-btn")) { openSheet(); return; }
    if (!t.closest("#sheet")) return;
    const d = t.closest<HTMLElement>(".op-dot");
    if (d) { picking = picking === d.dataset.key ? null : d.dataset.key!; pickErr = null; paintList(); return; }
    const nsw = t.closest<HTMLElement>(".op-new .op-sw");
    if (nsw) { newColor = nsw.dataset.c === newColor ? null : nsw.dataset.c!; paintNew(); return; }
    const sw = t.closest<HTMLElement>(".op-sw");
    if (sw && picking) { pick(picking, sw.dataset.c || null); return; }
    if (picking && !t.closest(".op-pick")) { picking = null; paintList(); }
    const b = t.closest<HTMLButtonElement>(".op-b");
    if (b) {
      if (b.disabled) return;
      if (b.classList.contains("vscode")) { const u = safeOpenUrl(b.dataset.url); if (u) nav.go(u); } else go(b.dataset.url || null);
      return;
    }
    if (t.closest(".op-x")) { closeSheet(); return; }
    const r = t.closest<HTMLElement>(".op-row");
    if (!r) return;
    const k = r.dataset.group ? `g:${r.dataset.group}` : r.dataset.key!;
    if (!expanded.delete(k)) expanded.add(k);
    paintList();
  });
  document.addEventListener("input", (e) => {
    const t = e.target as HTMLElement;
    if (!(t instanceof HTMLInputElement) || !t.closest("#sheet")) return;
    if (t.classList.contains("op-new-name")) paintNew();
    else { filter = t.value; paintList(); }
  });
  document.addEventListener("change", (e) => { if ((e.target as Element).closest?.(".op-new-root")) paintNew(); });
  document.addEventListener("submit", (e) => {
    if (!(e.target as Element).closest?.("#sheet .op-new")) return;
    e.preventDefault(); submitNew();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && picking) { e.preventDefault(); picking = null; paintList(); return; }
    if ((e.key === "ArrowRight" || e.key === "ArrowLeft") && (e.target as Element).closest?.(".op-pick")) {
      const all = [...document.querySelectorAll<HTMLElement>(".op-pick .op-sw")], i = all.indexOf(e.target as HTMLElement);
      if (i >= 0) { e.preventDefault(); all[(i + (e.key === "ArrowRight" ? 1 : all.length - 1)) % all.length].focus(); }
      return;
    }
    if (e.key === "Escape" && sheetOpen()) { e.preventDefault(); closeSheet(); return; }
    if (e.key === "Enter" && (e.target as Element).closest?.(".op-new-name")) { e.preventDefault(); submitNew(); return; }
    if (e.key !== "o" && e.key !== "O") return;
    if (e.metaKey || e.ctrlKey || e.altKey || store.demo || $("#open-btn")!.hidden) return;
    const a = document.activeElement;
    if (a instanceof HTMLElement && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName))) return;
    e.preventDefault(); openSheet();
  });
}
