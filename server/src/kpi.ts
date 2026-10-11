import type { Kpi } from "@fo/shared";
import { DAY_MS, KPIS, KPI_EXE_M2_MIN_USD } from "./config";
import type { CallRow, CycleRow, EscalationRow, SpendRow } from "./reducer";

export interface KpiInput { escalations: EscalationRow[]; cycles: CycleRow[]; calls: CallRow[]; spend: SpendRow[] }

const WINDOW_MS = { "7d": 7 * DAY_MS, "30d": 30 * DAY_MS } as const;

function kpi(id: keyof typeof KPIS, value: number | null, n: number, ready: boolean): Kpi {
  const d = KPIS[id];
  const high = value !== null && d.max !== null && value > d.max;
  const low = value !== null && d.min !== null && value < d.min;
  const warn = ready && (high || low);
  return { id, tile: d.tile, value, unit: d.unit, healthy: d.healthy, window: d.window, n, ready, warn, next: warn ? (high ? d.nextHigh : d.nextLow) : null };
}

const inCycle = (c: CycleRow, sid: string | null, ts: number) => sid === c.sid && c.ended !== null && ts >= c.started && ts <= c.ended;
const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const a = [...xs].sort((x, y) => x - y), m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};
const sum = (xs: number[]) => xs.reduce((t, x) => t + x, 0);

/** Dryas KPIs from stored rows: pure (no I/O, no clock). KPIs come from closed build cycles, plan tasks and escalations over 7-day and 30-day windows. */
export function kpis(i: KpiInput, now: number): Kpi[] {
  const since = (w: keyof typeof WINDOW_MS) => now - WINDOW_MS[w];
  const closed = (w: keyof typeof WINDOW_MS) => i.cycles.filter((c) => c.ended !== null && c.ended >= since(w) && c.ended <= now);

  const c7 = closed("7d");
  const p7 = c7.filter((c) => (c.planTasks ?? 0) > 0);
  const tasks7 = sum(p7.map((c) => c.planTasks ?? 0));
  const climbs = i.escalations.filter((e) => e.from === "sonnet" && e.to === "opus" && p7.some((c) => inCycle(c, e.sid, e.ts))).length;
  const escM1 = kpi("ESC-M1", tasks7 > 0 ? climbs / tasks7 : null, tasks7, tasks7 >= KPIS["ESC-M1"].minN);

  const calls7 = i.calls.filter((c) => c.ts >= since("7d"));
  const judged = calls7.filter((c) => c.role === "judge").length;
  const over = calls7.filter((c) => c.role === "override").length;
  const govM2 = kpi("GOV-M2", judged > 0 ? over / judged : null, judged, judged >= KPIS["GOV-M2"].minN);

  const esc7 = i.escalations.filter((e) => e.ts >= since("7d"));
  const escM2 = kpi("ESC-M2", esc7.filter((e) => e.to === "fable" && e.from !== "opus").length, esc7.length, true);

  const shipped30 = closed("30d").filter((c) => c.outcome === "shipped");
  const reviewed = shipped30.filter((c) => (c.reviews ?? 0) > 0);
  const revM1 = kpi("REV-M1", median(reviewed.map((c) => (c.reviews ?? 0) - 1)), reviewed.length, reviewed.length >= KPIS["REV-M1"].minN);

  const spend7 = i.spend.filter((s) => s.ts >= since("7d"));
  const jev = sum(spend7.filter((s) => s.source === "jev").map((s) => s.usd));
  const claude = sum(spend7.filter((s) => s.source === "claude").map((s) => s.usd));
  const claudeRows = spend7.filter((s) => s.source === "claude").length;
  const exeM2 = kpi("EXE-M2", claude > 0 ? jev / claude : null, claudeRows, claude >= KPI_EXE_M2_MIN_USD);

  const paid = shipped30.filter((c) => (c.planTasks ?? 0) > 0);
  const paidTasks = sum(paid.map((c) => c.planTasks ?? 0));
  const paidUsd = sum(i.spend.filter((s) => s.source === "claude" && paid.some((c) => inCycle(c, s.sid, s.ts))).map((s) => s.usd));
  const exeM3 = kpi("EXE-M3", paidTasks > 0 ? paidUsd / paidTasks : null, paid.length, paid.length >= KPIS["EXE-M3"].minN);

  const rows = (role: CallRow["role"], w: keyof typeof WINDOW_MS) => i.calls.filter((c) => c.role === role && c.ts >= since(w) && c.ts <= now);
  const waitKpi = (id: "FO-GATE" | "FO-SHIP") => {
    const r = rows(id === "FO-GATE" ? "gate" : "ship", "7d").filter((c) => c.ms !== null);
    return kpi(id, median(r.map((c) => c.ms as number)), r.length, r.length >= KPIS[id].minN);
  };
  const tries = rows("try", "30d");
  const foTry = kpi("FO-TRY", tries.length ? tries.filter((c) => c.ok === false).length / tries.length : null, tries.length, tries.length >= KPIS["FO-TRY"].minN);

  return [escM1, govM2, escM2, revM1, exeM2, exeM3, waitKpi("FO-GATE"), waitKpi("FO-SHIP"), foTry];
}
