import { kpiDetail, type JevUsage, type Kpi, type Metric, type Metrics, type Spend, type Status } from "@fo/shared";
import type { CallRow, SpendRow, TransitionRow } from "./reducer";

export type Range = "today" | "7d" | "month";
export const RANGES = new Set<string>(["today", "7d", "month"]);

export function localMidnight(now: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function monthStart(now: number): number {
  const d = new Date(localMidnight(now));
  d.setDate(1);
  return d.getTime();
}

export function rangeStart(r: Range, now: number): number {
  if (r === "today") return localMidnight(now);
  if (r === "month") return monthStart(now);
  const d = new Date(localMidnight(now));
  d.setDate(d.getDate() - 6);
  return d.getTime();
}

const BLOCKED = new Set<Status>(["waiting", "deny", "handoff"]);

/** Spec §4: blocked intervals from transitions, clipped to [from, to], summed across sessions. */
export function blockedMs(rows: TransitionRow[], from: number, to: number): number {
  const bySid = new Map<string, TransitionRow[]>();
  for (const r of rows) {
    const list = bySid.get(r.sid) ?? [];
    list.push(r);
    bySid.set(r.sid, list);
  }
  let total = 0;
  for (const list of bySid.values()) {
    for (let i = 0; i < list.length; i++) {
      if (!BLOCKED.has(list[i].toStatus)) continue;
      const a = Math.max(list[i].ts, from);
      const b = Math.min(i + 1 < list.length ? list[i + 1].ts : to, to);
      if (b > a) total += b - a;
    }
  }
  return total;
}

export function quantile(xs: number[], q: number): number | null {
  if (!xs.length) return null;
  const a = [...xs].sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.floor(q * a.length))];
}

const ROLES = ["plan", "build", "judge", "escalate", "review"] as const;
const DEFAULT_MODEL: Record<(typeof ROLES)[number], string> = { plan: "opus", build: "sonnet", judge: "jev", escalate: "opus", review: "opus" };
const pct = (x: number) => Math.round(x * 100);

function mode(xs: string[], fallback: string): string {
  const n = new Map<string, number>();
  for (const x of xs) n.set(x, (n.get(x) ?? 0) + 1);
  let best = fallback, top = 0;
  for (const [k, v] of n) if (v > top) { best = k; top = v; }
  return best;
}

/** A role tile's hover line and glow come from its Dryas KPI, once that KPI has enough sample. */
function signalFor(role: string, kpis: Kpi[]): { signal: string | null; warn: boolean } {
  const k = kpis.find((x) => x.tile === role && x.ready && x.value !== null);
  return k ? { signal: kpiDetail(k), warn: k.warn } : { signal: null, warn: false };
}

export function metrics(calls: CallRow[], kpis: Kpi[] = []): Metrics {
  const out = {} as Record<(typeof ROLES)[number], Metric>;
  for (const role of ROLES) {
    const rs = calls.filter((c) => c.role === role);
    const ms = rs.map((c) => c.ms).filter((x): x is number => x !== null);
    out[role] = {
      model: mode(rs.map((c) => c.model), DEFAULT_MODEL[role]), calls: rs.length,
      p50: quantile(ms, 0.5), p95: quantile(ms, 0.95), ...signalFor(role, kpis),
    };
  }
  return out;
}

const round = (x: number) => Math.round(x * 1e6) / 1e6;

export function aggregateSpend(rows: SpendRow[]): Spend {
  const by = new Map<string, Spend["rows"][number]>();
  for (const r of rows) {
    const key = `${r.project}\u0000${r.model}\u0000${r.source}`;
    const cur = by.get(key) ?? { project: r.project, model: r.model, source: r.source, usd: 0 };
    cur.usd += r.usd;
    by.set(key, cur);
  }
  const out = [...by.values()].map((r) => ({ ...r, usd: round(r.usd) })).sort((a, b) => b.usd - a.usd);
  return { rows: out, totalUsd: round(out.reduce((t, r) => t + r.usd, 0)) };
}

export function jevUsage(rows: SpendRow[], now: number, budgetUsd: number): JevUsage {
  const start = monthStart(now);
  const used = rows.filter((r) => r.source === "jev" && r.ts >= start).reduce((t, r) => t + r.usd, 0);
  return { usedUsd: round(used), budgetUsd, monthStart: start };
}
