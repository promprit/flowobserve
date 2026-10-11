import type { Spend } from "@fo/shared";
import { SPEND_TIMEOUT_MS } from "../config";
import { store } from "../state";
import { $, esc } from "../util";

export type Range = "today" | "7d" | "month";
export type Row = Spend["rows"][number];
export type FetchFn = (url: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

const RANGES: Range[] = ["today", "7d", "month"];
const DOMINANT = 0.5;
/** A family under this many dollars in the range never gets a hint: a share of cents is not worth acting on. */
const MIN_HINT_USD = 1;
/** Rows below half a cent print as $0.00 in every column, so they are hidden. */
const shown = (usd: number) => usd >= 0.005;
/** Next step per model family; families without one never get a hint (warn only with a next step). */
const NEXT: Record<string, string> = { opus: "check escalations", fable: "check escalations", sonnet: "split plan tasks smaller", jev: "run /tune" };
const LABEL: Record<string, string> = { opus: "Opus", fable: "Fable", sonnet: "Sonnet", haiku: "Haiku", jev: "Jev" };
const family = (r: Row) => r.source === "jev" ? "jev" : (/opus|fable|sonnet|haiku/i.exec(r.model)?.[0].toLowerCase() ?? r.model);
const money = (n: number) => `$${n.toFixed(2)}`;
const sum = (rs: Row[]) => rs.reduce((a, r) => a + r.usd, 0);

export function byProject(rows: Row[]): { project: string; claude: number; jev: number }[] {
  const m = new Map<string, { project: string; claude: number; jev: number }>();
  for (const r of rows) {
    const p = m.get(r.project) ?? { project: r.project, claude: 0, jev: 0 };
    p[r.source] = +(p[r.source] + r.usd).toFixed(6);
    m.set(r.project, p);
  }
  return [...m.values()].sort((a, b) => b.claude + b.jev - (a.claude + a.jev));
}

export function byModel(rows: Row[]): { model: string; source: "claude" | "jev"; usd: number }[] {
  const m = new Map<string, { model: string; source: "claude" | "jev"; usd: number }>();
  for (const r of rows) {
    const k = `${r.source}|${r.model}`, x = m.get(k) ?? { model: r.model, source: r.source, usd: 0 };
    x.usd += r.usd;
    m.set(k, x);
  }
  return [...m.values()].sort((a, b) => b.usd - a.usd);
}

export function spendHints(rows: Row[]): string[] {
  const groups = new Map<string, Row[]>();
  for (const r of rows) if (r.project !== "unattributed") {
    const f = family(r);
    groups.set(f, [...(groups.get(f) ?? []), r]);
  }
  const out: string[] = [];
  for (const [f, rs] of groups) {
    const total = sum(rs), per = new Map<string, number>();
    for (const r of rs) per.set(r.project, (per.get(r.project) ?? 0) + r.usd);
    if (!NEXT[f] || total < MIN_HINT_USD || per.size < 2) continue;
    const [project, usd] = [...per].sort((a, b) => b[1] - a[1])[0];
    if (usd / total >= DOMINANT) out.push(`${project} uses ${Math.round((100 * usd) / total)}% of ${LABEL[f] ?? f} spend · ${NEXT[f]}`);
  }
  return out;
}

/** The drawer ends just above the tile block (#usage), whatever the dock height: it never covers the tile that opened it. */
function placeDrawer(): void {
  const d = $("#drawer")!, u = $("#usage")!, dock = $("#dock")!;
  d.style.bottom = `${Math.max(0, dock.clientHeight - u.offsetTop) + 12}px`;
}

let seq = 0;
let current: Range = "today";

function paint(range: Range, body: string): void {
  const d = $("#drawer")!;
  placeDrawer();
  const tabs = RANGES.map((r) => `<b data-r="${r}" class="${r === range ? "on" : ""}">${r === "7d" ? "7 D" : r.toUpperCase()}</b>`).join("");
  d.innerHTML = `<div class="dr-h"><span class="cap">USAGE</span><span class="dr-tabs">${tabs}</span><button class="dr-x" aria-label="Close">×</button></div>${body}`;
}
const note = (t: string) => `<p class="dr-note">${esc(t)}</p>`;

function table(head: string, cells: string[][]): string {
  const cols = store.jev ? 3 : 2;
  return `<div class="dr-t${store.jev ? "" : " two"}"><span class="cap">${head}</span><span class="cap">CLAUDE</span>${store.jev ? '<span class="cap">JEV</span>' : ""}` +
    cells.map((c) => c.slice(0, cols).map((x) => `<span>${esc(x)}</span>`).join("")).join("") + "</div>";
}

function report(rows: Row[]): string {
  if (!rows.length) return note("NO SPEND IN THIS RANGE");
  const claude = sum(rows.filter((r) => r.source === "claude")), jev = sum(rows.filter((r) => r.source === "jev"));
  return `<p class="dr-tot">CLAUDE ${money(claude)} <small>API-EQUIVALENT</small>${store.jev ? ` · JEV ${money(jev)}` : ""}</p>` +
    spendHints(rows).map((h) => `<p class="dr-hint">${esc(h)}</p>`).join("") +
    table("BY PROJECT", byProject(rows).filter((p) => shown(p.claude) || shown(p.jev)).map((p) => [p.project, money(p.claude), money(p.jev)])) +
    table("BY MODEL", byModel(rows).filter((m) => shown(m.usd)).map((m) => [m.model, m.source === "claude" ? money(m.usd) : "—", m.source === "jev" ? money(m.usd) : "—"]));
}

export async function openDrawer(range: Range = current, fetchFn: FetchFn = (u, i) => fetch(u, i)): Promise<void> {
  const my = ++seq;
  current = range;
  placeDrawer();
  $("#sheet")!.hidden = true;
  $("#drawer")!.hidden = false;
  if (!store.spendBase) { paint(range, note("NO SPEND DATA IN DEMO")); return; }
  paint(range, note("LOADING…"));
  let body: string;
  try {
    const r = await fetchFn(`${store.spendBase}/spend?range=${range}`, { signal: AbortSignal.timeout(SPEND_TIMEOUT_MS) });
    const j = (r.ok ? await r.json() : null) as { rows?: unknown } | null;
    body = j && Array.isArray(j.rows) ? report(j.rows as Row[]) : note("SPEND UNAVAILABLE");
  } catch {
    body = note("SPEND UNAVAILABLE");
  }
  if (my === seq && drawerOpen()) paint(range, body);
}

export const drawerOpen = () => !$("#drawer")!.hidden;
export function closeDrawer(): void { seq++; $("#drawer")!.hidden = true; }
export function toggleDrawer(): void { if (drawerOpen()) closeDrawer(); else void openDrawer(); }

export function bindDrawer(): void {
  $("#drawer")!.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    if (t.closest(".dr-x")) closeDrawer();
    else if (t.dataset.r) void openDrawer(t.dataset.r as Range);
  });
}
