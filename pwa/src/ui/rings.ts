import type { AccountUsage, Usage } from "@fo/shared";
import { FIVE_HOUR_MS, PACE_WARN } from "../config";
import { store, ui } from "../state";
import { DAYS, clamp, clock, esc } from "../util";

/** Several accounts as rings (spec §11): one column per account, rings 5H · WK · FAB showing what is left. */

export const MAX_COLS = 4;
export const CYCLE_MS = 8000;
export const FADE_MS = 350;
const WEEK_MS = 7 * 86400e3;
const R = 17, C = 2 * Math.PI * R;

type Fable = NonNullable<Usage["fable"]>;

/** What is left of a limit, as an integer percent; null = not reported. */
export const ringsLeft = (used: number | null): number | null => used === null ? null : Math.round(clamp(1 - used, 0, 1) * 100);

/** One ring: track, an arc as long as what is left, the number inside. Amber and dim are classes. */
export function ringSvg(left: number | null, warn: boolean): string {
  const arc = left === null || left === 0 ? "" :
    `<circle class="fg" cx="20" cy="20" r="${R}" stroke-dasharray="${(C * left / 100).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 20 20)"/>`;
  return `<span class="ring${warn ? " hot" : ""}${left === null ? " dim" : ""}"><svg viewBox="0 0 40 40" aria-hidden="true">` +
    `<circle class="tr" cx="20" cy="20" r="${R}"/>${arc}</svg><span class="n">${left === null ? "—" : left}</span></span>`;
}

/** Amber at 10 % left or less (judged on the integer shown, so a ring reading 10 is always amber), or ahead of pace (the tiles' 15-point rule). */
const warnAt = (left: number, used: number, pace: number): boolean => left <= 10 || used > pace + PACE_WARN;

function rg(k: string, used: number | null, pace: number, live: boolean): string {
  const l = ringsLeft(used);
  return `<span class="rg" title="${k} · ${l === null ? "not reported" : `${l}% left`}">${ringSvg(l, live && used !== null && l !== null && warnAt(l, used, pace))}<span class="cap">${k}</span></span>`;
}

export interface ColumnOpts { you: boolean; t: number; key?: boolean; dots?: { n: number; on: number }; fable?: Fable | null }

/** One account: label (green dot on the account you are on), then 5H, WK and FAB rings. */
export function accountColumn(a: AccountUsage, opts: ColumnOpts): string {
  const { t } = opts, S = a.session, F = opts.fable ?? null;
  const reset = S.startedAt + S.windowMs <= t, stale = reset || t - a.at > FIVE_HOUR_MS;
  const sPace = clamp((t - S.startedAt) / S.windowMs, 0, 1);
  const wkPace = (resetsAt: number) => clamp(1 - (resetsAt - t) / WEEK_MS, 0, 1);
  const dots = opts.dots ? `<span class="dots">${Array.from({ length: opts.dots.n }, (_, i) => `<i class="${i === opts.dots!.on ? "on" : ""}"></i>`).join("")}</span>` : "";
  const asOf = stale ? ` title="AS OF ${DAYS[new Date(a.at).getDay()]} ${clock(a.at)}"` : "";
  return `<div class="rcol${opts.dots ? " cyc" : ""}${stale ? " stale" : ""}"${asOf}>` +
    `<span class="hd">${opts.you ? '<i class="you"></i>' : ""}<span class="al" title="${esc(a.label)}">${esc(a.label)}</span>${opts.key ? '<span class="rk">5H · WK · FAB</span>' : ""}${dots}</span>` +
    `<span class="trio">${rg("5H", reset ? null : S.used, sPace, !stale)}${rg("WK", a.weekly.used, wkPace(a.weekly.resetsAt), !stale)}` +
    `${rg("FAB", F ? F.used : null, F ? wkPace(F.resetsAt) : 0, !stale)}</span></div>`;
}

/** The rings block: the account you are on first, up to 4 columns; from 5 accounts the 4th cycles through the rest. */
export function claudeRings(accounts: AccountUsage[], cycle: number, ctx: { t: number; fable?: Fable | null; key?: boolean }): string {
  const pri = accounts.find((a) => a.primary) ?? accounts[0];
  const list = [pri, ...accounts.filter((a) => a !== pri)];
  const rest = list.slice(MAX_COLS - 1), cyc = list.length > MAX_COLS;
  const on = cyc ? ((cycle % rest.length) + rest.length) % rest.length : 0;
  const shown = cyc ? [...list.slice(0, MAX_COLS - 1), rest[on]] : list;
  const col = (a: AccountUsage, i: number) => accountColumn(a, {
    you: a === pri, t: ctx.t, ...(a === pri && ctx.key ? { key: true } : {}), fable: a === pri ? ctx.fable ?? null : null,
    ...(cyc && i === MAX_COLS - 1 ? { dots: { n: rest.length, on } } : {}),
  });
  return `<div class="rings" style="--c:${shown.length}">${shown.map(col).join("")}</div>`;
}

/** Every 8 s, with 5 or more accounts: fade the cycled column out (0.35 s), move on, fade the next one in.
 *  Under prefers-reduced-motion the column just changes. Returns a stop function. */
export function startRingCycle(render: () => void, count: () => number = () => store.usage?.accounts?.length ?? 0): () => void {
  let fade: ReturnType<typeof setTimeout> | undefined;
  const step = () => {
    ui.cycle++;
    render();
    if (!ui.reduce) for (const c of document.querySelectorAll(".rcol.cyc")) c.classList.add("in");
  };
  const id = setInterval(() => {
    if (count() <= MAX_COLS) return;
    if (ui.reduce) { step(); return; }
    for (const c of document.querySelectorAll(".rcol.cyc")) c.classList.add("out");
    fade = setTimeout(step, FADE_MS);
  }, CYCLE_MS);
  return () => { clearInterval(id); clearTimeout(fade); };
}
