import { kpiValue, type Host, type Kpi, type Usage } from "@fo/shared";
import { FIVE_HOUR_MS } from "../config";
import { now, store, ui } from "../state";
import { $, DAYS, clock, esc } from "../util";
import { toggleDrawer } from "./drawer";
import { bytes, cpuWin, gpuWin, hostLevel, noteCpu, noteGpu } from "./host";
import { left } from "./usage";

/** Portrait slim row (spec §5): hairline meters, label / value / note per cell. Usage is never amber. */
export interface SlimCell { k: string; v: string; n: string; fill: number | null; hot: boolean; dim: boolean; dot?: boolean }

const cell = (k: string, v: string, n: string, fill: number | null, hot = false, dim = false, dot?: boolean): SlimCell =>
  dot ? { k, v, n, fill, hot, dim, dot } : { k, v, n, fill, hot, dim };
const when = (t: number): string => `${DAYS[new Date(t).getDay()]} ${clock(t)}`;
const pct = (x: number): string => `${Math.round(x * 100)}%`;

export function usageCells(u: Usage | null, kpis: Kpi[], t: number): SlimCell[] {
  if (!u) return [cell("USAGE", "NO DATA YET", "", null, false, true)];
  const S = u.session, sReset = S.startedAt + S.windowMs;
  const reset = sReset <= t, stale = reset || t - u.at > FIVE_HOUR_MS;
  const cost = kpis.find((k) => k.id === "EXE-M3" && k.ready && k.value !== null);
  const out = [
    reset ? cell("5H", "—", "", null, false, true) : cell("5H", pct(S.used), left(sReset - t), S.used, false, stale),
    cell("WEEK", pct(u.weekly.used), when(u.weekly.resetsAt), u.weekly.used, false, stale),
  ];
  // Other accounts near their 5h limit: one letter each (the switch hint itself shows on the landscape usage tile).
  for (const a of u.accounts ?? []) if (!a.primary && a.near) out.push(cell(Array.from(a.label).slice(0, 2).join("").toUpperCase(), pct(a.session.used), "5H", a.session.used));
  if (u.fable) out.push(cell("FABLE", pct(u.fable.used), when(u.fable.resetsAt), u.fable.used, false, stale, true));
  const J = u.jev;
  if (J) out.push(cell("JEV", `$${J.usedUsd.toFixed(2)}`, `OF $${J.budgetUsd}${cost ? ` · ${kpiValue(cost)}/TASK` : ""}`, J.budgetUsd > 0 ? J.usedUsd / J.budgetUsd : null));
  return out;
}

export function hostSlim(h: Host, cpuAvg: number, gpu: number | null): SlimCell[] {
  const pressure = h.mem.pressure !== "normal";
  const out = [
    cell("CPU", pct(h.cpu), gpu === null ? "GPU —" : `GPU ${pct(gpu)}`, h.cpu, cpuAvg > 0.85),
    cell("MEM", pct(h.mem.used), pressure ? "PRESSURE" : "", h.mem.used, h.mem.used > 0.85 || pressure),
  ];
  for (const d of h.disks) {
    const k = d.label.slice(0, 8).toUpperCase();
    if (d.used === null || d.freeBytes === null) out.push(cell(k, "OFFLINE", "", null, false, true));
    else { const low = hostLevel.disk(d) !== ""; out.push(cell(k, bytes(d.freeBytes), low ? "LOW" : "FREE", d.used, low)); }
  }
  return out;
}

const fillW = (f: number): number => Math.round(Math.max(0, Math.min(1, f)) * 1000) / 10;
const one = (c: SlimCell): string =>
  `<span class="c${c.hot ? " hot" : c.dim ? " dim" : ""}"><span class="t"><span class="k">${c.dot ? '<i class="sdot"></i>' : ""}${esc(c.k)}</span>` +
  `<span class="v">${esc(c.v)}</span><span class="n">${esc(c.n)}</span></span>` +
  `<span class="m">${c.fill === null ? "" : `<s style="width:${fillW(c.fill)}%"></s>`}</span></span>`;
const group = (cells: SlimCell[]): string =>
  `<div class="sr" style="--cols:${Math.max(4, cells.length)}">${cells.map(one).join("")}</div>`;

let lastHtml = "";
export function renderSlim(): void {
  const el = $("#slim")!;
  el.hidden = !ui.portrait;
  if (!ui.portrait) return;
  const h = store.host;
  const html = group(usageCells(store.usage, store.kpis, now())) +
    (h ? group(hostSlim(h, noteCpu(cpuWin, h), noteGpu(gpuWin, h))) : "");
  if (html !== lastHtml || el.innerHTML === "") { lastHtml = html; el.innerHTML = html; }
}

export function bindSlim(): void {
  const el = $("#slim")!;
  el.addEventListener("click", () => toggleDrawer());
  el.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); toggleDrawer(); } });
}
