import "./tiles.css";
import { kpiDetail, kpiValue, type JevUsage, type Kpi } from "@fo/shared";
import { FIVE_HOUR_MS, JEV_PACE_WARN, PACE_WARN } from "../config";
import { now, store } from "../state";
import { $, DAYS, clamp, clock, esc } from "../util";
import { toggleDrawer } from "./drawer";

export type Level = "" | "warn" | "crit";

export const claudeLevel = (used: number, pace: number): Level =>
  used >= 0.95 ? "crit" : used >= 0.8 || used > pace + PACE_WARN ? "warn" : "";

export function monthEnd(monthStart: number): number {
  const d = new Date(monthStart);
  return new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();
}

export function jevMeter(j: JevUsage, t: number): { used: number; pace: number; warn: boolean } {
  const used = j.budgetUsd > 0 ? j.usedUsd / j.budgetUsd : 0;
  const pace = clamp((t - j.monthStart) / (monthEnd(j.monthStart) - j.monthStart), 0, 1);
  return { used, pace, warn: used > pace + JEV_PACE_WARN };
}

const ahead = "<b>AHEAD OF PACE</b>";
/** h:mm time left (no seconds). */
export const left = (ms: number): string => { const m = Math.max(0, Math.floor(ms / 60000)); return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`; };

const bar = (used: number, pace: number): string =>
  `<div class="hl"><s style="width:${(clamp(used, 0, 1) * 100).toFixed(1)}%"></s><u style="left:${(pace * 100).toFixed(1)}%"></u></div>`;

/** One hairline row: label, value, bar with pace notch, one short fact. */
/** null used = unknown (its window reset after the last reading): a dash, an empty bar. */
const pct = (used: number | null): string => used === null ? "—" : `${Math.round(used * 100)}%`;

function row(k: string, used: number | null, pace: number, sub: string, hot: boolean): string {
  return `<div class="r limit${hot ? " hot" : ""}"><span class="cap">${k}</span><span class="n">${pct(used)}</span>${bar(used ?? 0, pace)}<span class="s">${sub}</span></div>`;
}

function tile(k: string, cls: string, used: number, pace: number, sub: string, hot: boolean, dot = false): string {
  return `<div class="tile limit${cls ? " " + cls : ""}${hot ? " hot" : ""}"><div class="top"><span class="cap">${dot ? '<i class="dot"></i>' : ""}${k}</span><span class="n">${pct(used)}</span></div>` +
    bar(used, pace) + `<div class="s">${sub}</div></div>`;
}

/** EXE-M2 and EXE-M3 as one quiet line under the Jev numeral; "" when neither is ready. */
function kpiLine(ks: Kpi[]): string {
  const ok = (id: Kpi["id"]) => ks.find((k) => k.id === id && k.ready && k.value !== null);
  const share = ok("EXE-M2"), cost = ok("EXE-M3");
  const parts = [share ? `${kpiValue(share)} OF SPEND` : "", cost ? `${kpiValue(cost)}/TASK` : ""].filter(Boolean);
  if (!parts.length) return "";
  const title = [share, cost].filter((k): k is Kpi => !!k).map(kpiDetail).join("\n");
  return `<div class="s kpi${share?.warn ? " hot" : ""}" title="${esc(title)}">${parts.join(" · ")}</div>`;
}

let lastHtml = "";
let lastEl: Element | null = null;
function setHtml(el: Element, html: string): void {
  if (lastEl === el && lastHtml === html && el.innerHTML !== "") return;
  lastEl = el; lastHtml = html; el.innerHTML = html;
}

export function renderUsage(): void {
  const el = $("#usage")!, u = store.usage;
  if (!u) { el.classList.remove("dim"); el.title = "Click for spend by project and model"; el.classList.remove("four"); setHtml(el, '<span class="none">USAGE · NO DATA YET</span>'); return; }
  const t = now(), S = u.session, Wk = u.weekly;
  const sPace = clamp((t - S.startedAt) / S.windowMs, 0, 1), sReset = S.startedAt + S.windowMs;
  const wPace = clamp(1 - (Wk.resetsAt - t) / (7 * 86400e3), 0, 1);
  const rd = new Date(Wk.resetsAt), j = u.jev ? jevMeter(u.jev, t) : null;
  const fPace = u.fable ? clamp(1 - (u.fable.resetsAt - t) / (7 * 86400e3), 0, 1) : 0, fd = new Date(u.fable?.resetsAt ?? 0);
  el.classList.toggle("four", !!u.fable);
  el.classList.toggle("nojev", !u.jev);
  // Claude limits arrive only via the CLI statusline or its usage cache; VS Code sessions feed neither.
  // Stale readings say when they were taken instead of posing as live. Jev is tailed live, never stale.
  const reset = sReset <= t, stale = reset || t - u.at > FIVE_HOUR_MS;
  const asOf = `AS OF ${DAYS[new Date(u.at).getDay()]} ${clock(u.at)}`;
  el.classList.remove("dim");
  el.title = stale ? `Claude limits last read ${asOf.slice(6)} · open claude in a terminal to refresh` : "Click for spend by project and model";
  const hot = (lv: Level) => !stale && lv !== "";
  const sub = (used: number, pace: number, live: string) => stale ? asOf : used > pace + PACE_WARN ? ahead : live;
  const st = stale ? " stale" : "";
  setHtml(el,
    `<div class="tile pair${st}">` +
    row("SESSION 5H", reset ? null : S.used, sPace, sub(S.used, sPace, `IN ${left(sReset - t)}`), hot(claudeLevel(S.used, sPace))) +
    row("WEEKLY", Wk.used, wPace, sub(Wk.used, wPace, `${DAYS[rd.getDay()]} ${clock(Wk.resetsAt)}`), hot(claudeLevel(Wk.used, wPace))) +
    `</div>` +
    (u.fable
      ? tile("FABLE", "fable" + st, u.fable.used, fPace,
        sub(u.fable.used, fPace, `${DAYS[fd.getDay()]} ${clock(u.fable.resetsAt)}`), hot(claudeLevel(u.fable.used, fPace)), true)
      : "") +
    (u.jev && j
      ? `<div class="tile num${j.warn ? " hot" : ""}"${j.warn ? ' title="Jev ahead of pace · run /tune"' : ""}><span class="cap">JEV</span>` +
        `<span class="big">$${u.jev.usedUsd.toFixed(2)}</span>` +
        `<div class="s">${j.warn ? ahead : `OF $${u.jev.budgetUsd}`}</div>${kpiLine(store.kpis)}</div>`
      : ""));
}

export function bindUsage(): void {
  const el = $("#usage")!;
  el.addEventListener("click", () => toggleDrawer());
  el.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); toggleDrawer(); } });
}
