import type { Host } from "@fo/shared";
import "./tiles.css";
import { store } from "../state";
import { $, clamp, esc } from "../util";

/** Mac host row (spec §3.3): quiet until a threshold; the word, not the colour, carries the meaning. */
export type HostLvl = "" | "warn" | "crit";
export interface HostCell { k: string; v: string; fill: number | null; lvl: HostLvl; word: string }

const GB = 1e9;
export const hostLevel = {
  cpu: (avg: number): HostLvl => (avg >= 0.95 ? "crit" : avg >= 0.85 ? "warn" : ""),
  gpu: (g: number | null): HostLvl => (g !== null && g >= 0.9 ? "warn" : ""),
  mem: (p: Host["mem"]["pressure"]): HostLvl => (p === "critical" ? "crit" : p === "warn" ? "warn" : ""),
  disk: (d: Host["disks"][number]): HostLvl => {
    if (d.used === null || d.freeBytes === null) return "";
    if (d.used >= 0.95 || d.freeBytes < 15 * GB) return "crit";
    if (d.used >= 0.85 || d.freeBytes < 50 * GB) return "warn";
    return "";
  },
};

export const bytes = (n: number): string => (n >= 1e12 ? `${(n / 1e12).toFixed(1)} TB` : `${Math.round(n / GB)} GB`);
const pct = (x: number): string => `${Math.round(x * 100)}%`;

/** Mean of the last 3 good CPU samples (spec §3.3); fewer than 3 → 0 (healthy) so the first poll never warns.
 *  A repeated sample (same `at`) is not counted twice. */
export const cpuWin = { at: 0, v: [] as number[] };
export function noteCpu(w: { at: number; v: number[] }, h: Host): number {
  if (h.at !== w.at) { w.at = h.at; w.v.push(h.cpu); if (w.v.length > 3) w.v.shift(); }
  return w.v.length < 3 ? 0 : w.v.reduce((a, b) => a + b, 0) / 3;
}

/** GPU shown as the mean of the last 3 non-null samples (fewer at start): ioreg is one instant per poll and jumps.
 *  Null until a sample arrives. A repeated sample (same `at`) is not counted twice. */
export const gpuWin = { at: 0, v: [] as number[] };
export function noteGpu(w: { at: number; v: number[] }, h: Host): number | null {
  if (h.at !== w.at && h.gpu !== null) { w.at = h.at; w.v.push(h.gpu); if (w.v.length > 3) w.v.shift(); }
  return w.v.length ? w.v.reduce((a, b) => a + b, 0) / w.v.length : null;
}
const GPU_TIP = "GPU busy, mean of the last 15 s. Includes this dashboard's own 3D view.";

export function hostCells(h: Host, cpuAvg: number): HostCell[] {
  const cells: HostCell[] = [
    { k: "CPU", v: pct(h.cpu), fill: h.cpu, lvl: hostLevel.cpu(cpuAvg), word: "HOT" },
    { k: "GPU", v: h.gpu === null ? "—" : pct(h.gpu), fill: h.gpu, lvl: hostLevel.gpu(h.gpu), word: "BUSY" },
    { k: "MEM", v: pct(h.mem.used), fill: h.mem.used, lvl: hostLevel.mem(h.mem.pressure), word: "PRESSURE" },
  ];
  for (const d of h.disks) cells.push(d.used === null || d.freeBytes === null
    ? { k: d.label.slice(0, 8).toUpperCase(), v: "offline", fill: null, lvl: "", word: "" }
    : { k: d.label.slice(0, 8).toUpperCase(), v: bytes(d.freeBytes), fill: d.used, lvl: hostLevel.disk(d), word: "LOW" });
  return cells;
}

let lastHtml = "";
export function renderHost(): void {
  const el = $("#host")!, h = store.host;
  $("#dock")!.classList.toggle("has-host", !!h);
  el.hidden = !h;
  if (!h) return;
  const cells = hostCells({ ...h, gpu: noteGpu(gpuWin, h) }, noteCpu(cpuWin, h));
  const arc = (c: HostCell): string => {
    const p = clamp(c.fill ?? 0, 0, 1);
    return `<div class="a${c.lvl ? " hot" : ""}"${c.k === "GPU" ? ` title="${GPU_TIP}"` : ""}><div class="ring"><svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="21" fill="none" stroke="rgba(242,240,234,.1)" stroke-width="3"/><circle cx="24" cy="24" r="21" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-dasharray="${(p * 131.9).toFixed(1)} 131.9" transform="rotate(-90 24 24)"/></svg><span class="n">${esc(c.v)}</span></div>` +
      `<div class="t"><span class="cap">${esc(c.k)}</span>${c.lvl ? `<span class="s">${c.word}</span>` : ""}</div></div>`;
  };
  // Disks (spec §11): hairlines stacked in a block one ring tall, captioned like the rings, so the row keeps its height at 1-4 disks.
  const dl = (c: HostCell): string => {
    const off = c.fill === null;
    return `<div class="dl${c.lvl ? " hot" : ""}"><span class="cap">${esc(c.k)}</span>` +
      `<div class="hl">${off ? "" : `<s style="width:${(clamp(c.fill!, 0, 1) * 100).toFixed(1)}%"></s>`}</div>` +
      `<span class="v">${off ? "OFFLINE" : `${esc(c.v)} <i>${c.lvl ? "LOW" : "FREE"}</i>`}</span></div>`;
  };
  const html = `<div class="tile arcs">${cells.slice(0, 3).map(arc).join("")}</div>` +
    `<div class="tile store"><div class="disks">${cells.length > 3 ? cells.slice(3).map(dl).join("") : '<div class="dl"><span class="v">—</span></div>'}</div>` +
    (cells.length - 3 >= 4 ? "" : '<span class="cap">STORAGE</span>') + "</div>"; // four disks take the caption's line too
  if (html !== lastHtml || el.innerHTML === "") { lastHtml = html; el.innerHTML = html; }
}
